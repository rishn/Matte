import { applyAdjustmentsBase64, blendBase64 } from './adjustments'

// Compose base image with all visible layers, in order
export async function composeImage(baseImage, layers) {
  if (!baseImage) return null
  let current = baseImage
  // Aggregate all visible adjustment layers (single-parameter) and multi adjustments layers
  const aggregate = {
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
  layers.forEach(l => {
    if (!l.visible) return
    if (l.type === 'adjustment') {
      const k = l.config?.kind
      const v = l.config?.value ?? 0
      if (k && k in aggregate) aggregate[k] += v
    } else if (l.type === 'adjustments') {
      // legacy multi adjustments layer
      Object.keys(aggregate).forEach(k => {
        if (typeof l.config?.[k] === 'number') aggregate[k] += l.config[k]
      })
    }
  })
  // Apply adjustments once if any non-zero
  if (Object.values(aggregate).some(v => v !== 0)) {
    current = await applyAdjustmentsBase64(current, aggregate)
  }
  // Apply filters in order
  for (const layer of layers) {
    if (!layer.visible) continue
    if (layer.type === 'filter') {
      const { preset, amount = 100, cachedResult } = layer.config || {}
      if (!preset) continue
      const alpha = Math.max(0, Math.min(1, amount / 100))
      const filtered = cachedResult || current
      current = alpha >= 1 ? filtered : await blendBase64(current, filtered, alpha)
    }
  }
  return current
}
