import axios from 'axios'

// Use the configured Vite env API URL when available (production),
// otherwise fall back to the relative `/api` path used in dev proxy.
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'

// Convert image file to base64
export const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => resolve(reader.result)
    reader.onerror = error => reject(error)
  })
}

// Auto segmentation (U2Net)
export const autoSegment = async (imageFile) => {
  const formData = new FormData()
  formData.append('file', imageFile)
  // Let the browser set the Content-Type including the boundary for multipart/form-data
  const response = await axios.post(`${API_BASE_URL}/segment/auto`, formData)
  
  return response.data
}

// Auto segmentation starting from a base64 data URL
export const autoSegmentBase64 = async (dataUrl) => {
  // Convert base64 data URL to Blob
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  const fileName = `image_${Date.now()}.png`
  const file = new File([blob], fileName, { type: blob.type || 'image/png' })
  return autoSegment(file)
}

// Interactive segmentation (SAM)
export const interactiveSegment = async (imageBase64, mode, points = null, box = null) => {
  const img = await ensureDataUrl(imageBase64)
  const response = await axios.post(`${API_BASE_URL}/segment/interactive`, {
    image: img,
    mode,
    points,
    box
  })

  return response.data
}

// Apply photo adjustments
export const applyAdjustments = async (imageBase64, adjustments) => {
  const img = await ensureDataUrl(imageBase64)
  const response = await axios.post(`${API_BASE_URL}/adjust`, {
    image: img,
    adjustments
  })

  return response.data
}

// Apply filter preset
export const applyFilter = async (imageBase64, preset) => {
  const img = await ensureDataUrl(imageBase64)
  const response = await axios.post(`${API_BASE_URL}/filter`, {
    image: img,
    preset
  })

  return response.data
}

// Helper: ensure the provided image is a data URL. If it's a remote URL, fetch and convert to data URL.
async function ensureDataUrl(imgOrUrl) {
  if (!imgOrUrl) return imgOrUrl
  try {
    // Already a data URL
    if (typeof imgOrUrl === 'string' && imgOrUrl.startsWith('data:')) return imgOrUrl
    // If it's a blob/object (File), convert via FileReader
    if (typeof File !== 'undefined' && imgOrUrl instanceof File) {
      return await fileToDataUrl(imgOrUrl)
    }
    // If it's a remote URL (http/https), fetch and convert
    if (typeof imgOrUrl === 'string' && (imgOrUrl.startsWith('http://') || imgOrUrl.startsWith('https://') || imgOrUrl.startsWith('/')) ) {
      const res = await fetch(imgOrUrl)
      if (!res.ok) throw new Error('Failed to fetch image for processing')
      const blob = await res.blob()
      return await fileToDataUrl(new File([blob], `f-${Date.now()}.png`, { type: blob.type || 'image/png' }))
    }
    // Otherwise return as-is
    return imgOrUrl
  } catch (e) {
    // Fallback: return input so the backend will return an error we can inspect
    return imgOrUrl
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = (err) => reject(err)
    reader.readAsDataURL(file)
  })
}

// Get available filters
export const getFilters = async () => {
  const response = await axios.get(`${API_BASE_URL}/filters/list`)
  return response.data.filters
}
