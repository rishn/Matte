import { addDoc, collection } from 'firebase/firestore'
import { db } from '../firebaseConfig'

const UPLOAD_ENDPOINT = import.meta.env.VITE_API_URL + '/upload' || '/api/upload'

export async function saveProjectForUser(user, imageDataUrl, title = null, projectState = null) {
  if (!user) throw new Error('Not authenticated')
  if (!imageDataUrl) throw new Error('No image to save')

  // create small thumbnail (for gallery)
  const thumb = await new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const maxDim = 256
      const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1)
      const w = Math.round(img.width * ratio)
      const h = Math.round(img.height * ratio)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      const thumbData = canvas.toDataURL('image/jpeg', 0.7)
      resolve(thumbData)
    }
    img.onerror = reject
    img.src = imageDataUrl
  })

  // Attempt to upload full-resolution PNG to backend (which will store in Supabase)
  let storagePath = null
  let storageUrl = null
  let uploadSucceeded = false
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = imageDataUrl
    })

    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (blob) {
      const token = await user.getIdToken()
      const fd = new FormData()
      const filename = `project-${Date.now()}.png`
      fd.append('file', blob, filename)

      const res = await fetch(UPLOAD_ENDPOINT, {
        method: 'POST',
        body: fd,
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      if (!res.ok) {
        // non-fatal: continue and save thumbnail-only metadata
        console.warn('Upload to backend failed', await res.text())
      } else {
        const json = await res.json()
        storagePath = json.storagePath
        storageUrl = json.signedUrl || json.signedURL || json.storageUrl
        uploadSucceeded = true
      }
    }
  } catch (e) {
    console.warn('Upload attempt failed, will save thumbnail-only', e)
  }

  const payload = {
    title: title || `Project ${new Date().toLocaleString()}`,
    thumbnailBase64: thumb,
    createdAt: Date.now(),
    meta: {},
  }
  // Sanitize projectState to avoid saving large base64 blobs into Firestore documents.
  // Firestore documents have a 1MB size limit; storing full images (data URLs / blobs)
  // in the document will exceed that. Instead, store only lightweight metadata and
  // references to uploaded storage paths. Remove any embedded image data and history
  // snapshots that may contain images.
  if (projectState) {
    try {
      const sanitize = (ps) => {
        const copy = {}
        // Keep adjustments (small numbers)
        if (ps.adjustments) copy.adjustments = ps.adjustments
        // Keep drawing strokes (vector data is small)
        if (ps.drawingStrokes) copy.drawingStrokes = ps.drawingStrokes
        // Keep layers but strip any embedded images or cached results
        if (ps.layers && Array.isArray(ps.layers)) {
          copy.layers = ps.layers.map(l => {
            const { id, name, type, visible, config } = l || {}
            const safeConfig = {}
            if (config) {
              // copy only small config values; explicitly ignore `image`, `cachedResult`, `inputHash`
              for (const k of Object.keys(config)) {
                if (k === 'image' || k === 'cachedResult' || k === 'inputHash') continue
                const v = config[k]
                // only copy primitives (numbers/strings/booleans)
                if (v === null) continue
                const t = typeof v
                if (t === 'string' || t === 'number' || t === 'boolean') safeConfig[k] = v
              }
            }
            return { id, name, type, visible, config: safeConfig }
          })
        }
        // Store only mask ids (do not store dataUrl/image blobs)
        if (ps.manualRemovalMasks && Array.isArray(ps.manualRemovalMasks)) {
          copy.manualRemovalMaskIds = ps.manualRemovalMasks.map(m => m && m.id).filter(Boolean)
        }
        // history may include images; keep only lightweight history metadata if present
        if (ps.history && Array.isArray(ps.history)) {
          copy.history = ps.history.map(h => ({
            timestamp: h.timestamp || null,
            adjustments: h.adjustments ? Object.keys(h.adjustments) : null,
            layersCount: Array.isArray(h.layers) ? h.layers.length : null,
          }))
        }
        return copy
      }
      payload.projectState = sanitize(projectState)
    } catch (e) {
      // Fall back to not saving projectState if sanitization fails
      console.warn('Failed to sanitize projectState for Firestore; omitting projectState', e)
    }
  }
  if (uploadSucceeded && storagePath) payload.storagePath = storagePath
  if (uploadSucceeded && storageUrl) payload.storageUrl = storageUrl
  // Track whether full-resolution upload succeeded
  payload.hasFullImage = !!uploadSucceeded

  const docRef = await addDoc(collection(db, 'users', user.uid, 'projects'), payload)
  return docRef.id
}
