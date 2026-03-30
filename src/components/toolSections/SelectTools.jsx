import { useStore } from '../../store/useStore'
import { interactiveSegment } from '../../services/api'

// Use store via getState() so these helpers can be called from Canvas handlers.
const store = () => useStore.getState()

// Parameters for point select:
// - e: the Stage event (we need stage pointer pos)
// - { canvasImage, currentImage, getImageDisplay, toImageSpace, shiftKey, showToastText }
//   - canvasImage: HTMLImageElement (displayed image)
//   - currentImage: base64 used for interactiveSegment
//   - getImageDisplay: function from Canvas to compute offsets/scale
//   - toImageSpace: helper to convert stage coords -> image-space (optional here)
//   - shiftKey: boolean (for add vs replace selection)
// Returns: resolves after selection set (uses store.setActiveSelection / addToActiveSelections)
export async function handlePointSelect(e, { canvasImage, currentImage, getImageDisplay, toImageSpace, shiftKey }) {
  if (!canvasImage || !currentImage) return
  store().setIsProcessing(true)
  store().showToast('Finding Subject...')
  try {
    const stage = e.target.getStage()
    const pos = stage.getPointerPosition()
    const { x: imgXOffset, y: imgYOffset, dw, dh } = getImageDisplay()
    const sx = canvasImage.width / Math.max(1, dw)
    const sy = canvasImage.height / Math.max(1, dh)
    const ip = { x: Math.round((pos.x - imgXOffset) * sx), y: Math.round((pos.y - imgYOffset) * sy), label: 1 }

    const result = await interactiveSegment(currentImage, 'point', [ip])
    if (!result || !result.mask) return

    // load mask image and process on canvas
    await new Promise((res) => {
      const mimg = new Image()
      mimg.src = result.mask
      mimg.onload = () => {
        const off = document.createElement('canvas')
        off.width = mimg.width; off.height = mimg.height
        const ctx = off.getContext('2d')
        ctx.drawImage(mimg, 0, 0)
        const imgData = ctx.getImageData(0,0,off.width,off.height)
        const data = imgData.data
        const W = off.width
        const H = off.height
        const maskAt = (x,y) => data[(y*W + x)*4]
        const THRESH = 20
        const inBounds = (x,y) => x>=0 && x<W && y>=0 && y<H

        // find valid seed near ip if original seed not in mask
        let sxSeed = ip.x; let sySeed = ip.y
        if (!inBounds(sxSeed, sySeed) || maskAt(sxSeed, sySeed) < THRESH) {
          let found = false
          const MAX_R = Math.max(3, Math.floor(Math.min(W,H) * 0.01))
          for (let r=1; r<=MAX_R && !found; r++) {
            for (let dy=-r; dy<=r && !found; dy++) {
              for (let dx=-r; dx<=r && !found; dx++) {
                const nx = sxSeed + dx; const ny = sySeed + dy
                if (inBounds(nx,ny) && maskAt(nx,ny) >= THRESH) { sxSeed = nx; sySeed = ny; found = true }
              }
            }
          }
          if (!found) { res(); return }
        }

        // flood fill connected component from seed
        const visited = new Uint8Array(W * H)
        const qx = [], qy = []
        qx.push(sxSeed); qy.push(sySeed); visited[sySeed*W + sxSeed] = 1
        let minX = sxSeed, minY = sySeed, maxX = sxSeed, maxY = sySeed
        const pushIf = (x,y) => {
          if (!inBounds(x,y)) return
          const idx = y*W + x
          if (visited[idx]) return
          if (maskAt(x,y) >= THRESH) { visited[idx] = 1; qx.push(x); qy.push(y) }
        }
        while (qx.length) {
          const x = qx.pop(), y = qy.pop()
          if (x < minX) minX = x; if (y < minY) minY = y
          if (x > maxX) maxX = x; if (y > maxY) maxY = y
          pushIf(x+1,y); pushIf(x-1,y); pushIf(x,y+1); pushIf(x,y-1)
        }

        if (maxX >= minX && maxY >= minY) {
          // collect boundary pixels
          const boundary = []
          const isVisited = (x,y) => visited[y*W + x] === 1
          for (let y=minY; y<=maxY; y++) {
            for (let x=minX; x<=maxX; x++) {
              if (!isVisited(x,y)) continue
              if (!isVisited(x+1,y) || !isVisited(x-1,y) || !isVisited(x,y+1) || !isVisited(x,y-1)) {
                boundary.push({ x,y })
              }
            }
          }
          // approximate ordering via nearest neighbor (same as Canvas)
          const ordered = []
          if (boundary.length) {
            let cur = boundary[0]; ordered.push(cur)
            const remaining = new Set(boundary.map((p,i)=>i)); remaining.delete(0)
            const dist2 = (a,b)=>{ const dx=a.x-b.x, dy=a.y-b.y; return dx*dx+dy*dy }
            while (remaining.size && ordered.length < 2000) {
              let bestIdx = null, bestD = Infinity
              for (const idx of remaining) {
                const d = dist2(cur, boundary[idx])
                if (d < bestD) { bestD = d; bestIdx = idx }
              }
              if (bestIdx == null) break
              cur = boundary[bestIdx]; ordered.push(cur); remaining.delete(bestIdx)
            }
          }
          const pts = (ordered.length ? ordered : [{ x:minX, y:minY }, { x:maxX, y:minY }, { x:maxX, y:maxY }, { x:minX, y:maxY }])
          const newSel = { type: 'lasso', points: pts }
          if (shiftKey) store().addToActiveSelections(newSel); else store().setActiveSelection(newSel)
        }
        res()
      }
    })
  } catch (err) {
    console.error('Point selection error:', err)
  } finally {
    store().setIsProcessing(false)
    store().hideToast()
  }
}

// Box handlers
// Parameters:
// - pos: stage pointer position {x,y} (from stage.getPointerPosition())
// - helpers: { boxStart, setBoxStart, setBoxEnd, canvasImage, getImageDisplay, shiftKey }
//   * boxStart, setBoxStart, setBoxEnd come from Canvas state (passed in)
//   * canvasImage and getImageDisplay used to compute image-space box for selection
export function selectBoxUp(pos, { boxStart, boxEnd, setBoxStart, setBoxEnd, canvasImage, getImageDisplay, shiftKey }) {
  if (!boxStart || !boxEnd || !canvasImage) {
    if (setBoxStart) setBoxStart(null)
    if (setBoxEnd) setBoxEnd(null)
    return
  }
  const { x: imgXOffset, y: imgYOffset, dw, dh } = getImageDisplay()
  const sx = canvasImage.width / Math.max(1, dw)
  const sy = canvasImage.height / Math.max(1, dh)
  const xStage = Math.min(boxStart.x, boxEnd.x)
  const yStage = Math.min(boxStart.y, boxEnd.y)
  const wStage = Math.abs(boxEnd.x - boxStart.x)
  const hStage = Math.abs(boxEnd.y - boxStart.y)
  const box = {
    x: Math.round((xStage - imgXOffset) * sx),
    y: Math.round((yStage - imgYOffset) * sy),
    w: Math.round(wStage * sx),
    h: Math.round(hStage * sy)
  }
  const newSel = { type: 'box', box }
  if (shiftKey) store().addToActiveSelections(newSel); else store().setActiveSelection(newSel)
  if (setBoxStart) setBoxStart(null)
  if (setBoxEnd) setBoxEnd(null)
}