// Client-side image adjustment utilities
// Applies adjustments on a canvas without backend calls

export async function applyAdjustmentsBase64(base64, adjustments) {
  // Load image
  const img = await loadImage(base64)
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)

  let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data

  const {
    brightness = 0,
    contrast = 0,
    exposure = 0,
    saturation = 0,
    temperature = 0,
    tint = 0,
    highlights = 0,
    shadows = 0,
    vignette = 0,
    sharpness = 0,
  } = adjustments

  // Precompute factors
  const brightnessOffset = brightness * 2.55
  const contrastFactor = 1 + (contrast / 100)
  const exposureFactor = Math.pow(2, exposure)
  const saturationFactor = 1 + (saturation / 100)
  const tempFactor = temperature / 100
  const tintFactor = tint / 100

  // Iterate pixels
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]

    // Apply exposure (scale all channels)
    r *= exposureFactor
    g *= exposureFactor
    b *= exposureFactor

    // Apply brightness/contrast
    r = (r - 128) * contrastFactor + 128 + brightnessOffset
    g = (g - 128) * contrastFactor + 128 + brightnessOffset
    b = (b - 128) * contrastFactor + 128 + brightnessOffset

    // Temperature (push red vs blue)
    r += tempFactor * 50
    b -= tempFactor * 50

    // Tint (push green)
    g += tintFactor * 50

    // Convert to HSL-ish for saturation (approx)
    const avg = (r + g + b) / 3
    r = avg + (r - avg) * saturationFactor
    g = avg + (g - avg) * saturationFactor
    b = avg + (b - avg) * saturationFactor

    // Highlights/Shadows: compute luminance
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const highlightAdj = highlights * 0.005
    const shadowAdj = shadows * 0.005
    if (lum > 180) {
      r += highlightAdj * (255 - r)
      g += highlightAdj * (255 - g)
      b += highlightAdj * (255 - b)
    } else if (lum < 75) {
      r += shadowAdj * r
      g += shadowAdj * g
      b += shadowAdj * b
    }

    data[i] = clamp(r)
    data[i + 1] = clamp(g)
    data[i + 2] = clamp(b)
  }

  ctx.putImageData(imageData, 0, 0)

  // Vignette (radial darken)
  if (vignette > 0) {
    const vigCtx = ctx
    vigCtx.globalCompositeOperation = 'source-over'
    const grad = vigCtx.createRadialGradient(
      canvas.width / 2,
      canvas.height / 2,
      Math.min(canvas.width, canvas.height) * 0.2,
      canvas.width / 2,
      canvas.height / 2,
      Math.max(canvas.width, canvas.height) * 0.6
    )
    const strength = vignette / 100
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(1, `rgba(0,0,0,${0.5 * strength})`)
    vigCtx.fillStyle = grad
    vigCtx.fillRect(0, 0, canvas.width, canvas.height)
  }

  // Basic sharpness (unsharp mask)
  if (sharpness > 0) {
    const original = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const blurred = blurImageData(original, 1)
    const oData = original.data
    const bData = blurred.data
    const sFactor = sharpness / 100
    for (let i = 0; i < oData.length; i += 4) {
      oData[i] = clamp(oData[i] + (oData[i] - bData[i]) * sFactor)
      oData[i + 1] = clamp(oData[i + 1] + (oData[i + 1] - bData[i + 1]) * sFactor)
      oData[i + 2] = clamp(oData[i + 2] + (oData[i + 2] - bData[i + 2]) * sFactor)
    }
    ctx.putImageData(original, 0, 0)
  }

  return canvas.toDataURL('image/png')
}

function clamp(v) {
  return Math.max(0, Math.min(255, v))
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// Simple box blur for unsharp mask
function blurImageData(imageData, radius = 1) {
  const { width, height, data } = imageData
  const out = new ImageData(width, height)
  const outData = out.data
  const r = radius
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0, count = 0
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const idx = (ny * width + nx) * 4
            rSum += data[idx]
            gSum += data[idx + 1]
            bSum += data[idx + 2]
            aSum += data[idx + 3]
            count++
          }
        }
      }
      const oIdx = (y * width + x) * 4
      outData[oIdx] = rSum / count
      outData[oIdx + 1] = gSum / count
      outData[oIdx + 2] = bSum / count
      outData[oIdx + 3] = aSum / count
    }
  }
  return out
}

// Blend two base64 images by amount (0..1), preserving alpha
export async function blendBase64(baseDataUrl, topDataUrl, amount = 1) {
  const base = await loadImage(baseDataUrl)
  const top = await loadImage(topDataUrl)
  // Blend into the base image's pixel grid to avoid scaling artifacts when
  // top image has different dimensions (e.g. cached filter results from a
  // previous image size). Use base image size as destination so visual
  // appearance remains consistent after crop/resize operations.
  const w = base.width
  const h = base.height
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, w, h)
  ctx.globalAlpha = 1
  // Draw base at its native size
  ctx.drawImage(base, 0, 0, w, h)
  // Draw top scaled to base size using requested alpha
  ctx.globalAlpha = Math.max(0, Math.min(1, amount))
  try {
    ctx.drawImage(top, 0, 0, w, h)
  } catch (e) {
    // Fallback: if drawing scaled image fails for some reason, draw without scaling
    try { ctx.drawImage(top, 0, 0) } catch (ee) { /* ignore */ }
  }
  ctx.globalAlpha = 1
  return canvas.toDataURL('image/png')
}
