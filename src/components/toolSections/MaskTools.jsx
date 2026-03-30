import { useStore } from '../../store/useStore'
import { autoSegmentBase64, applyFilter } from '../../services/api'
import { applyAdjustmentsBase64, blendBase64 } from '../../utils/adjustments'

// Module-level paths to avoid passing refs between files
let bgErasePath = null
let bgRestorePath = null

function toImagePoint(pos, canvasImage, getImageDisplay) {
  if (!canvasImage || !getImageDisplay) return { x: pos.x, y: pos.y }
  const { x: imgXOffset, y: imgYOffset, dw, dh } = getImageDisplay()
  const sx = canvasImage.width / Math.max(1, dw)
  const sy = canvasImage.height / Math.max(1, dh)
  return { x: Math.round((pos.x - imgXOffset) * sx), y: Math.round((pos.y - imgYOffset) * sy) }
}

export function startBgErase(pos, canvasImage, getImageDisplay) {
  bgErasePath = []
  const imgPt = toImagePoint(pos, canvasImage, getImageDisplay)
  bgErasePath.push({ imgX: imgPt.x, imgY: imgPt.y, canvasX: pos.x, canvasY: pos.y })
}
export function updateBgErase(pos, canvasImage, getImageDisplay) {
  if (!bgErasePath) return
  const imgPt = toImagePoint(pos, canvasImage, getImageDisplay)
  bgErasePath.push({ imgX: imgPt.x, imgY: imgPt.y, canvasX: pos.x, canvasY: pos.y })
}
export async function asyncFinishBgErase() {
  const store = useStore.getState()
  const currentImage = store.currentImage
  if (!bgErasePath || !currentImage) { bgErasePath = null; return }
  const img = new Image()
  img.src = currentImage
  await new Promise((res) => { img.onload = res; img.onerror = res })
  try {
    const off = document.createElement('canvas')
    off.width = img.width
    off.height = img.height
    const ctx = off.getContext('2d')
    ctx.drawImage(img, 0, 0)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.strokeStyle = 'rgba(0,0,0,1)'
    ctx.lineWidth = store.bgEraserSize * 2
    ctx.beginPath()
    bgErasePath.forEach((pt,i)=>{
      const x = pt.imgX, y = pt.imgY
      if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
    })
    ctx.stroke()
    // Create a manual mask for the erased stroke
    let maskEntry = null
    try {
      const mask = document.createElement('canvas')
      mask.width = img.width
      mask.height = img.height
      const mctx = mask.getContext('2d')
      mctx.lineJoin = 'round'
      mctx.lineCap = 'round'
      mctx.strokeStyle = '#000'
      mctx.lineWidth = store.bgEraserSize * 2
      mctx.beginPath()
      bgErasePath.forEach((pt, i) => { const x = pt.imgX, y = pt.imgY; if (i === 0) mctx.moveTo(x, y); else mctx.lineTo(x, y) })
      mctx.stroke()
      const maskData = mask.toDataURL('image/png')
      maskEntry = { id: Date.now(), dataUrl: maskData }
    } catch (e) {
      console.warn('Failed to create manualRemovalMask for bg erase', e)
    }

    // Prepare erased preview result image and stage it (do not immediately commit)
      try {
      const baseImgData = off.toDataURL('image/png')
      if (maskEntry) {
        // Build a preview that re-applies visible filters/adjustments and pen layers
        // on top of the manually erased base so the staged preview matches the user's
        // visual edits prior to saving.
        async function composePreviewFromBase(baseDataUrl) {
          let working = baseDataUrl
          try {
            // Apply adjustment-type layers first
            const layers = store.layers || []
            for (const layer of layers) {
              if (!layer.visible) continue
              if (layer.type === 'adjustment') {
                const k = layer.config?.kind
                const v = layer.config?.value ?? 0
                if (k && typeof v === 'number' && v !== 0) {
                  const adj = {
                    brightness: 0,
                    contrast: 0,
                    exposure: 0,
                    saturation: 0,
                    temperature: 0,
                    tint: 0,
                    highlights: 0,
                    shadows: 0,
                    vignette: 0,
                    sharpness: 0,
                  }
                  adj[k] = v
                  try { working = await applyAdjustmentsBase64(working, adj) } catch (e) { console.warn('composePreviewFromBase: adjustment apply failed', e) }
                }
              }
              if (layer.type === 'adjustments') {
                const conf = layer.config || {}
                if (Object.values(conf).some(val => typeof val === 'number' && val !== 0)) {
                  try { working = await applyAdjustmentsBase64(working, conf) } catch (e) { console.warn('composePreviewFromBase: adjustments apply failed', e) }
                }
              }
            }
            // Apply filter layers progressively
            for (const layer of store.layers || []) {
              if (!layer.visible || layer.type !== 'filter') continue
              const { preset, amount = 100 } = layer.config || {}
              if (!preset) continue
              try {
                const res = await applyFilter(working, preset)
                const filteredImage = res?.result || working
                const alpha = Math.max(0, Math.min(1, amount / 100))
                if (alpha >= 1) {
                  working = filteredImage
                } else if (alpha > 0) {
                  working = await blendBase64(working, filteredImage, alpha)
                }
              } catch (e) {
                console.warn('composePreviewFromBase: filter apply failed', e)
              }
            }
            // Composite pen layers on top
            const penLayers = (store.layers || []).filter(l => l.visible && l.type === 'pen')
            if (penLayers.length) {
              try {
                const baseImg = new Image()
                baseImg.src = working
                await new Promise((res) => { baseImg.onload = res; baseImg.onerror = res })
                const W = baseImg.width, H = baseImg.height
                const off = document.createElement('canvas')
                off.width = W; off.height = H
                const ctx = off.getContext('2d')
                ctx.drawImage(baseImg, 0, 0)
                for (const pl of penLayers) {
                  if (!pl.config || !pl.config.image) continue
                  const img = new Image()
                  img.src = pl.config.image
                  // eslint-disable-next-line no-await-in-loop
                  await new Promise((res) => { img.onload = res; img.onerror = res })
                  ctx.drawImage(img, 0, 0)
                }
                working = off.toDataURL('image/png')
              } catch (e) { console.warn('composePreviewFromBase: pen composite failed', e) }
            }
          } catch (e) {
            console.warn('composePreviewFromBase failed', e)
          }
          return working
        }

        let preview = baseImgData
        try { preview = await composePreviewFromBase(baseImgData) } catch (e) { /* ignore */ }
        // Stage removal so the user can restore and save like selection flows
        try { store.stageRemoval(maskEntry, preview) } catch (e) { useStore.setState({ currentImage: preview }) }
      } else {
        // no mask available -> just update preview and commit
        useStore.setState({ currentImage: baseImgData })
        if (typeof store.recomputeComposite === 'function') await store.recomputeComposite()
        if (typeof store.pushHistorySnapshot === 'function') store.pushHistorySnapshot()
      }
    } catch (e) {
      console.warn('Failed to stage bg erase result', e)
    }
  } catch (e) {
    console.warn('asyncFinishBgErase failed', e)
  }
  bgErasePath = null
}

export function startBgRestore(pos, canvasImage, getImageDisplay) {
  bgRestorePath = []
  const imgPt = toImagePoint(pos, canvasImage, getImageDisplay)
  bgRestorePath.push({ imgX: imgPt.x, imgY: imgPt.y, canvasX: pos.x, canvasY: pos.y })
}
export function updateBgRestore(pos, canvasImage, getImageDisplay) {
  if (!bgRestorePath) return
  const imgPt = toImagePoint(pos, canvasImage, getImageDisplay)
  bgRestorePath.push({ imgX: imgPt.x, imgY: imgPt.y, canvasX: pos.x, canvasY: pos.y })
}
export async function asyncFinishBgRestore() {
  const store = useStore.getState()
  const currentImage = store.currentImage
  if (!bgRestorePath || !currentImage) { bgRestorePath = null; return }

  // For restores we want pixels from the original unmodified image so we can re-insert removed areas.
  // Prefer a "filtered original" that reflects current adjustment/filter layers so restored
  // pixels keep the visual filters applied. If no filters/adjustments exist, fall back
  // to `baseImage` or `currentImage`.
  let sourceImage = store.baseImage || currentImage

  // Helper: compute a filtered/adjusted version of `src` using current layers (adjustment + filter)
  async function computeFilteredSource(src) {
    if (!src) return src
    let working = src
    // Apply adjustment-type layers first (they operate on the image)
    const layers = store.layers || []
    for (const layer of layers) {
      if (!layer.visible) continue
      if (layer.type === 'adjustment') {
        const k = layer.config?.kind
        const v = layer.config?.value ?? 0
        if (k && typeof v === 'number' && v !== 0) {
          const adj = {
            brightness: 0,
            contrast: 0,
            exposure: 0,
            saturation: 0,
            temperature: 0,
            tint: 0,
            highlights: 0,
            shadows: 0,
            vignette: 0,
            sharpness: 0,
          }
          adj[k] = v
          try {
            // applyAdjustmentsBase64 returns a base64 data url
            // eslint-disable-next-line no-await-in-loop
            working = await applyAdjustmentsBase64(working, adj)
          } catch (e) {
            console.warn('computeFilteredSource: adjustment apply failed', e)
          }
        }
      }
    }
    // Apply filter layers progressively
    for (const layer of layers) {
      if (!layer.visible || layer.type !== 'filter') continue
      const { preset, amount = 100 } = layer.config || {}
      if (!preset) continue
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await applyFilter(working, preset)
        let filteredImage = res?.result || working
        const alpha = Math.max(0, Math.min(1, amount / 100))
        if (alpha >= 1) {
          working = filteredImage
        } else if (alpha > 0) {
          // blendBase64 blends two base64 images by alpha
          // eslint-disable-next-line no-await-in-loop
          working = await blendBase64(working, filteredImage, alpha)
        }
      } catch (e) {
        console.warn('computeFilteredSource: filter apply failed', e)
      }
    }
    return working
  }

  // If there are filter/adjustment layers, prefer a filtered version of the original image
  const hasFiltersOrAdjustments = (store.layers || []).some(l => l.visible && (l.type === 'filter' || l.type === 'adjustment' || l.type === 'adjustments'))
  if (hasFiltersOrAdjustments) {
    // compute filtered original to preserve filter appearance when restoring
    try {
      const filteredOriginal = await computeFilteredSource(store.originalImageBase64 || store.baseImage || currentImage)
      if (filteredOriginal) sourceImage = filteredOriginal
    } catch (e) {
      console.warn('Failed to compute filtered source for restore', e)
      sourceImage = store.originalImageBase64 || store.baseImage || currentImage
    }
  } else {
    sourceImage = store.baseImage || store.originalImageBase64 || currentImage
  }

  const imgCur = new Image()
  const imgSource = new Image()
  imgCur.src = currentImage
  imgSource.src = sourceImage
  // wait for both images to load (use Promises so we can await)
  await Promise.all([
    new Promise((res) => { imgSource.onload = res; imgSource.onerror = res }),
    new Promise((res) => { imgCur.onload = res; imgCur.onerror = res }),
  ])

  const W = imgCur.width
  const H = imgCur.height
      // Stroke mask
      const mask = document.createElement('canvas')
      mask.width = W
      mask.height = H
      const mctx = mask.getContext('2d')
      mctx.lineJoin = 'round'
      mctx.lineCap = 'round'
      mctx.strokeStyle = '#000'
      const restSize = store.bgRestorerSize
      const feather = store.bgRestorerFeather
      mctx.lineWidth = restSize * 2
      mctx.beginPath()
      // draw using image-space coordinates saved in the path
      bgRestorePath.forEach((pt,i)=>{ const x = pt.imgX, y = pt.imgY; if(i===0) mctx.moveTo(x, y); else mctx.lineTo(x, y) })
      mctx.stroke()

      if (feather > 0) {
        const id = mctx.getImageData(0,0,W,H)
        const alpha = new Uint8ClampedArray(W*H)
        for (let i=0;i<W*H;i++) alpha[i] = id.data[i*4+3]
        const rad = feather
        const tmp = new Uint8ClampedArray(W*H)
        for (let y=0;y<H;y++) {
          let acc=0; let count=0
          for (let x=0;x<W;x++) {
            const idx=y*W+x
            acc += alpha[idx]; count++
            if (x>=rad) { acc -= alpha[y*W + (x-rad)]; count-- }
            tmp[idx] = acc / count
          }
        }
        for (let x=0;x<W;x++) {
          let acc=0; let count=0
          for (let y=0;y<H;y++) {
            const idx=y*W+x
            acc += tmp[idx]; count++
            if (y>=rad) { acc -= tmp[(y-rad)*W + x]; count-- }
            alpha[idx] = acc / count
          }
        }
        for (let i=0;i<W*H;i++) id.data[i*4+3] = alpha[i]
        mctx.putImageData(id,0,0)
      }

      // If source image pixel dimensions don't match the current image, try to find
      // a candidate (originalImageBase64 / base layer) that matches. This ensures
      // restores sample the same pixel grid as the cropped/current image.
      if (imgSource.width !== W || imgSource.height !== H) {
        try {
          const candidates = [store.originalImageBase64, (store.layers || []).find(l => l.type === 'base' && l.config && l.config.image)?.config?.image, store.baseImage, currentImage]
          for (const cand of candidates) {
            if (!cand) continue
            if (cand === sourceImage) continue
            // load candidate and check size
            // eslint-disable-next-line no-await-in-loop
            const testImg = new Image()
            testImg.src = cand
            // eslint-disable-next-line no-await-in-loop
            await new Promise((res) => { testImg.onload = res; testImg.onerror = res })
            if (testImg.width === W && testImg.height === H) {
              imgSource.src = cand
              // await re-load
              // eslint-disable-next-line no-await-in-loop
              await new Promise((res) => { imgSource.onload = res; imgSource.onerror = res })
              break
            }
          }
        } catch (e) {
          // ignore and fall back to proportional sampling below
        }
      }

      const sourceStroke = document.createElement('canvas')
      sourceStroke.width = W
      sourceStroke.height = H
      const ssctx = sourceStroke.getContext('2d')
      // If the source image now matches the current image dimensions, we can draw
      // directly and mask. Otherwise we'll sample per-pixel to map between grids.
      let useDirectDraw = (imgSource.width === W && imgSource.height === H)
      if (useDirectDraw) {
        ssctx.drawImage(imgSource, 0, 0, W, H)
        ssctx.globalCompositeOperation = 'destination-in'
        ssctx.drawImage(mask, 0, 0)
        ssctx.globalCompositeOperation = 'source-over'
      }

      const out = document.createElement('canvas')
      out.width = W
      out.height = H
      const octx = out.getContext('2d')
      // draw current image (may contain transparent/erased pixels)
      // draw at explicit dimensions to ensure internal canvas buffer matches image pixels
      octx.drawImage(imgCur, 0, 0, W, H)

      // Instead of blindly drawing the restored pixels over the current image,
      // copy pixels from sourceStroke only where the current image is transparent
      // (alpha === 0). This prevents restoring non-erased areas.
      try {
        const baseData = octx.getImageData(0, 0, W, H)
        const bd = baseData.data
        // Get mask alpha data to compute bounding box and mask test
        const maskData = mctx.getImageData(0, 0, W, H).data
        // find bbox of mask to limit processing
        let minX = W, minY = H, maxX = 0, maxY = 0
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const midx = (y * W + x) * 4 + 3
            if (maskData[midx] > 0) {
              if (x < minX) minX = x
              if (y < minY) minY = y
              if (x > maxX) maxX = x
              if (y > maxY) maxY = y
            }
          }
        }
        if (minX > maxX || minY > maxY) {
          // nothing to restore
        } else {
          // clamp bbox
          minX = Math.max(0, minX - 1)
          minY = Math.max(0, minY - 1)
          maxX = Math.min(W - 1, maxX + 1)
          maxY = Math.min(H - 1, maxY + 1)

          if (useDirectDraw) {
            const sctx = sourceStroke.getContext('2d')
            const srcData = sctx.getImageData(minX, minY, maxX - minX + 1, maxY - minY + 1).data
            let di = 0
            for (let y = minY; y <= maxY; y++) {
              for (let x = minX; x <= maxX; x++) {
                const i = (y * W + x) * 4
                const si = di
                di += 4
                if (srcData[si + 3] > 0 && bd[i + 3] < 250) {
                  bd[i] = srcData[si]
                  bd[i + 1] = srcData[si + 1]
                  bd[i + 2] = srcData[si + 2]
                  bd[i + 3] = srcData[si + 3]
                }
              }
            }
          } else {
            // Per-pixel sampling from the source image grid
            const sCanvas = document.createElement('canvas')
            sCanvas.width = imgSource.width
            sCanvas.height = imgSource.height
            const sCtxFull = sCanvas.getContext('2d')
            sCtxFull.drawImage(imgSource, 0, 0)
            const fullSrc = sCtxFull.getImageData(0, 0, imgSource.width, imgSource.height).data
            const scaleX = imgSource.width / W
            const scaleY = imgSource.height / H
            for (let y = minY; y <= maxY; y++) {
              for (let x = minX; x <= maxX; x++) {
                const i = (y * W + x) * 4
                const midx = (y * W + x) * 4 + 3
                if (maskData[midx] === 0) continue
                if (bd[i + 3] >= 250) continue
                const sx = Math.min(imgSource.width - 1, Math.max(0, Math.floor(x * scaleX)))
                const sy = Math.min(imgSource.height - 1, Math.max(0, Math.floor(y * scaleY)))
                const sidx = (sy * imgSource.width + sx) * 4
                if (fullSrc[sidx + 3] > 0) {
                  bd[i] = fullSrc[sidx]
                  bd[i + 1] = fullSrc[sidx + 1]
                  bd[i + 2] = fullSrc[sidx + 2]
                  bd[i + 3] = fullSrc[sidx + 3]
                }
              }
            }
          }
        }
        octx.putImageData(baseData, 0, 0)
      } catch (e) {
        // Fallback: if pixel manipulation fails for any reason, draw normally
        console.warn('Restore pixel-copy failed, falling back to simple draw', e)
        octx.drawImage(sourceStroke, 0, 0)
      }
        // Before committing, clear any pen-layer pixels that overlap the restored mask
        try {
          const layers = store.layers || []
          // If we are restoring into a staged removal (triggered from a select tool or eraser/auto-remove),
          // we should update the staged removal mask and preview image without committing
          const selectionParents = ['lasso', 'box', 'magic-wand', 'image-eraser', 'remove-bg']
          // If the restorer was opened from 'remove-bg' we must treat restores as staged-only
          // (preview + stagedRemoval updates) and NOT commit to the base image until the
          // user explicitly presses Save. For other selection parents, require an existing
          // stagedRemoval to be considered a staged context.
          const isStagedContext = (store.restorerParent === 'remove-bg') || (!!store.stagedRemoval && selectionParents.includes(store.restorerParent))

          if (layers.length) {
            // For permanent restores (no stagedRemoval), snapshot history so pen-layer modification can be undone
            if (!isStagedContext && typeof store.pushHistorySnapshot === 'function') store.pushHistorySnapshot()

            // Update pen layers by loading each pen image, erasing mask area, and producing new image dataURLs
            const updated = await Promise.all(layers.map(layer => {
              if (layer.type === 'pen' && layer.config && layer.config.image) {
                return new Promise((res) => {
                  try {
                    const limg = new Image()
                    limg.onload = () => {
                      try {
                        const pc = document.createElement('canvas')
                        pc.width = W; pc.height = H
                        const pctx = pc.getContext('2d')
                        pctx.drawImage(limg, 0, 0)
                        // erase pen pixels where mask is painted
                        pctx.globalCompositeOperation = 'destination-out'
                        pctx.drawImage(mask, 0, 0)
                        pctx.globalCompositeOperation = 'source-over'
                        const newImg = pc.toDataURL('image/png')
                        res({ ...layer, config: { ...layer.config, image: newImg } })
                      } catch (e) { console.warn('Failed to clear pen layer for restore', e); res(layer) }
                    }
                    limg.onerror = () => res(layer)
                    limg.src = layer.config.image
                  } catch (e) { console.warn('Failed to process pen layer', e); res(layer) }
                })
              }
              return Promise.resolve(layer)
            }))
            // replace layers in state so UI reflects updated pen images
            useStore.setState({ layers: updated })

            // If this is a staged restore, we should update the staged removal mask and preview image,
            // but not commit the base layer or push history yet.
            if (isStagedContext) {
              try {
                // Update staged removal mask by subtracting restored mask (destination-out)
                const staged = store.stagedRemoval
                if (staged && staged.dataUrl) {
                  const sImg = new Image()
                  sImg.src = staged.dataUrl
                  await new Promise((res) => { sImg.onload = res; sImg.onerror = res })
                  const sc = document.createElement('canvas')
                  sc.width = W; sc.height = H
                  const sctx = sc.getContext('2d')
                  sctx.drawImage(sImg, 0, 0, W, H)
                  sctx.globalCompositeOperation = 'destination-out'
                  sctx.drawImage(mask, 0, 0)
                  sctx.globalCompositeOperation = 'source-over'
                  const newMaskUrl = sc.toDataURL('image/png')
                  // update stagedRemoval in store
                  useStore.setState((s) => ({ stagedRemoval: { ...(s.stagedRemoval || {}), dataUrl: newMaskUrl } }))
                }
              } catch (e) {
                console.warn('Failed to update stagedRemoval mask during staged restore', e)
              }
              // Update preview image (currentImage) to the restored result
              try {
                const previewUrl = out.toDataURL('image/png')
                useStore.setState({ currentImage: previewUrl })
              } catch (e) { /* ignore */ }
              bgRestorePath = null
              return
            }
          }
        } catch (e) {
          console.warn('Pen-layer clearing during restore failed', e)
        // If there are manual removal masks or an auto mask, subtract the restored area so future auto-remove
        // or reapplication does not re-clear the restored pixels. We do this by drawing the restored mask
        // onto each manual mask using 'destination-out'. Also update the global `mask` if present.
        try {
          const restoredMask = mask // canvas with restored stroke drawn
          const manual = store.manualRemovalMasks || []
          const locked = store.lockedManualRemovalIds || []
          if (manual.length) {
            const updatedManual = await Promise.all(manual.map(async (m) => {
              // If this manual mask is locked (was saved), do not modify it
              if (locked && locked.includes(m.id)) return m
              try {
                const mimg = new Image()
                mimg.src = m.dataUrl
                await new Promise((res) => { mimg.onload = res; mimg.onerror = res })
                const mc = document.createElement('canvas')
                mc.width = W; mc.height = H
                const mctx = mc.getContext('2d')
                mctx.drawImage(mimg, 0, 0, W, H)
                // erase restored area from this manual mask
                mctx.globalCompositeOperation = 'destination-out'
                mctx.drawImage(restoredMask, 0, 0)
                mctx.globalCompositeOperation = 'source-over'
                return { ...m, dataUrl: mc.toDataURL('image/png') }
              } catch (e) {
                console.warn('Failed to update manual removal mask during restore', e)
                return m
              }
            }))
            useStore.setState({ manualRemovalMasks: updatedManual })
          }
          // Update global auto-remove mask if present
          if (store.mask) {
            try {
              const mid = new Image()
              mid.src = store.mask
              await new Promise((res) => { mid.onload = res; mid.onerror = res })
              const mc = document.createElement('canvas')
              mc.width = W; mc.height = H
              const mctx = mc.getContext('2d')
              mctx.drawImage(mid, 0, 0, W, H)
              mctx.globalCompositeOperation = 'destination-out'
              mctx.drawImage(restoredMask, 0, 0)
              mctx.globalCompositeOperation = 'source-over'
              useStore.getState().setMask(mc.toDataURL('image/png'))
            } catch (e) {
              console.warn('Failed to update global auto-remove mask during restore', e)
            }
          }
        } catch (e) {
          console.warn('Failed to adjust manualRemovalMasks or mask during restore', e)
        }

      }

      // Update the first base layer's image so effects/filters above it continue to apply
      try {
        const baseImgData = out.toDataURL('image/png')
        const layers = store.layers || []
        const newLayers = layers.map(l => l.type === 'base' ? { ...l, config: { ...l.config, image: baseImgData } } : l)
        useStore.setState({ layers: newLayers })
        // Recompute composite first so currentImage reflects the change, then snapshot history
        await store.recomputeComposite()
        if (typeof store.pushHistorySnapshot === 'function') store.pushHistorySnapshot()
      } catch (e) {
        console.warn('Failed to apply restore to base layer', e)
      }
      bgRestorePath = null
}

export async function autoRemoveBackground() {
  const store = useStore.getState()
  const currentImage = store.currentImage
  if (!currentImage) return
  store.setIsProcessing(true)
  store.showToast('Removing Background...')
  try {
    // Run auto-segmentation on the current 'base' layer image (respects crop), fallback to other sources
    let sourceForAuto = currentImage
    try {
      const baseLayer = (store.layers || []).find(l => l.type === 'base' && l.config && l.config.image)
      sourceForAuto = baseLayer?.config?.image || store.baseImage || store.originalImageBase64 || currentImage
    } catch (e) {
      sourceForAuto = store.baseImage || store.originalImageBase64 || currentImage
    }
    const result = await autoSegmentBase64(sourceForAuto)
    if (result && result.result) {
      // If there are manual removal masks, reapply them onto the auto-removed result
      let combined = result.result
      if (store.manualRemovalMasks && store.manualRemovalMasks.length > 0) {
        const resImg = new Image()
        resImg.src = result.result
        await new Promise((resolve) => { resImg.onload = resolve })
        const W = resImg.width
        const H = resImg.height
        const out = document.createElement('canvas')
        out.width = W
        out.height = H
        const octx = out.getContext('2d')
        octx.drawImage(resImg, 0, 0)

        // For each stored manual removal mask, draw it with destination-out to clear pixels
        for (const m of store.manualRemovalMasks) {
          try {
            const mimg = new Image()
            mimg.src = m.dataUrl
            await new Promise((resolve) => { mimg.onload = resolve })
            // draw mask using destination-out so mask alpha clears underlying pixels
            octx.globalCompositeOperation = 'destination-out'
            octx.drawImage(mimg, 0, 0, W, H)
            octx.globalCompositeOperation = 'source-over'
          } catch (e) {
            console.warn('Failed to apply manual removal mask', e)
          }
        }

        combined = out.toDataURL('image/png')
      }
      // Instead of committing immediately, stage the auto-remove result so user can
      // restore and save like selection-based flows. Build a mask entry from the
      // API-provided mask when available; otherwise derive a mask from the result image's alpha.
      try {
        let maskDataUrl = null
        if (result.mask) {
          maskDataUrl = result.mask
        } else {
          try {
            const rimg = new Image()
            rimg.src = combined
            // eslint-disable-next-line no-await-in-loop
            await new Promise((res) => { rimg.onload = res; rimg.onerror = res })
            const W = rimg.width, H = rimg.height
            const mc = document.createElement('canvas')
            mc.width = W; mc.height = H
            const mctx = mc.getContext('2d')
            mctx.drawImage(rimg, 0, 0, W, H)
            const id = mctx.getImageData(0,0,W,H)
            // create a black mask where alpha is zero (i.e. removed)
            const out = document.createElement('canvas')
            out.width = W; out.height = H
            const octx = out.getContext('2d')
            octx.fillStyle = '#000'
            octx.fillRect(0,0,W,H)
            const maskImg = octx.getImageData(0,0,W,H)
            for (let i=0;i<W*H;i++) {
              // if result alpha > 0, punch hole (destination-out semantics)
              const a = id.data[i*4+3]
              if (a > 0) {
                maskImg.data[i*4+3] = 0
              } else {
                maskImg.data[i*4+3] = 255
              }
            }
            octx.putImageData(maskImg,0,0)
            maskDataUrl = out.toDataURL('image/png')
          } catch (e) {
            console.warn('Failed to derive mask from auto-remove result', e)
          }
        }

        const maskEntry = { id: Date.now(), dataUrl: maskDataUrl }
        // Build a preview that re-applies visible filters/adjustments and pen layers
        // on top of the auto-removed base so the staged preview matches the user's
        // visual edits prior to saving.
        async function composePreviewFromBase(baseDataUrl) {
          let working = baseDataUrl
          try {
            // Apply adjustment-type layers first
            const layers = store.layers || []
            for (const layer of layers) {
              if (!layer.visible) continue
              if (layer.type === 'adjustment') {
                const k = layer.config?.kind
                const v = layer.config?.value ?? 0
                if (k && typeof v === 'number' && v !== 0) {
                  const adj = {
                    brightness: 0,
                    contrast: 0,
                    exposure: 0,
                    saturation: 0,
                    temperature: 0,
                    tint: 0,
                    highlights: 0,
                    shadows: 0,
                    vignette: 0,
                    sharpness: 0,
                  }
                  adj[k] = v
                  try { working = await applyAdjustmentsBase64(working, adj) } catch (e) { console.warn('composePreviewFromBase: adjustment apply failed', e) }
                }
              }
              if (layer.type === 'adjustments') {
                const conf = layer.config || {}
                if (Object.values(conf).some(val => typeof val === 'number' && val !== 0)) {
                  try { working = await applyAdjustmentsBase64(working, conf) } catch (e) { console.warn('composePreviewFromBase: adjustments apply failed', e) }
                }
              }
            }
            // Apply filter layers progressively
            for (const layer of store.layers || []) {
              if (!layer.visible || layer.type !== 'filter') continue
              const { preset, amount = 100 } = layer.config || {}
              if (!preset) continue
              try {
                const res = await applyFilter(working, preset)
                const filteredImage = res?.result || working
                const alpha = Math.max(0, Math.min(1, amount / 100))
                if (alpha >= 1) {
                  working = filteredImage
                } else if (alpha > 0) {
                  working = await blendBase64(working, filteredImage, alpha)
                }
              } catch (e) {
                console.warn('composePreviewFromBase: filter apply failed', e)
              }
            }
            // Composite pen layers on top
            const penLayers = (store.layers || []).filter(l => l.visible && l.type === 'pen')
            if (penLayers.length) {
              try {
                const baseImg = new Image()
                baseImg.src = working
                await new Promise((res) => { baseImg.onload = res; baseImg.onerror = res })
                const W = baseImg.width, H = baseImg.height
                const off = document.createElement('canvas')
                off.width = W; off.height = H
                const ctx = off.getContext('2d')
                ctx.drawImage(baseImg, 0, 0)
                for (const pl of penLayers) {
                  if (!pl.config || !pl.config.image) continue
                  const img = new Image()
                  img.src = pl.config.image
                  // eslint-disable-next-line no-await-in-loop
                  await new Promise((res) => { img.onload = res; img.onerror = res })
                  ctx.drawImage(img, 0, 0)
                }
                working = off.toDataURL('image/png')
              } catch (e) { console.warn('composePreviewFromBase: pen composite failed', e) }
            }
          } catch (e) {
            console.warn('composePreviewFromBase failed', e)
          }
          return working
        }

        let previewCombined = combined
        try { previewCombined = await composePreviewFromBase(combined) } catch (e) { /* ignore */ }
        // Ensure preview is shown immediately
        try { useStore.setState({ currentImage: previewCombined }) } catch (e) {}
        // Stage removal preview (do not commit manualRemovalMasks/history) so user may restore and save
        try { store.stageRemoval(maskEntry, previewCombined) } catch (e) { useStore.setState({ currentImage: previewCombined }) }
      } catch (e) {
        console.warn('Failed to stage auto-remove result', e)
        // fallback: apply as full image commit
        try { store.setImage(combined, true) } catch (ee) { /* ignore */ }
      }
    }
    if (result && result.mask) store.setMask(result.mask)
  } catch (e) {
    console.error('Auto remove failed', e)
  } finally {
    store.setIsProcessing(false)
    store.hideToast()
  }
}

export default {
  startBgErase,
  updateBgErase,
  asyncFinishBgErase,
  startBgRestore,
  updateBgRestore,
  asyncFinishBgRestore,
  autoRemoveBackground
}
