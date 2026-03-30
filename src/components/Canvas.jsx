import React, { useRef, useEffect, useState } from 'react'
import { Stage, Layer, Image as KonvaImage, Circle, Rect, Line, Group } from 'react-konva'
import { useStore } from '../store/useStore'
import { Image as ImageIcon } from 'lucide-react'
import './Canvas.css'
import CropTool from './toolSections/CropTool'
import PenStrokesRenderer, { penMouseDown, penMouseMove, penMouseUp, PenCursor } from './toolSections/PenTool'
import { startBgErase, updateBgErase, asyncFinishBgErase, startBgRestore, updateBgRestore, asyncFinishBgRestore } from './toolSections/MaskTools'
import { handlePointSelect, selectBoxUp } from './toolSections/SelectTools'

function Canvas() {
  const {
    currentImage,
    activeTool,
    penDropper,
    lassoPath,
    activeSelection,
    selectionPoints,
    bgEraserSize,
    setPenColor,
    addLassoPoint,
    setCropRect,
    cropRect,
    setActiveSelection,
    cropPresetRatio,
  } = useStore()
  // Subscribe to toast so the Canvas re-renders when toast changes
  const toast = useStore(state => state.toast)

  const containerRef = useRef(null)
  const stageRef = useRef(null)
  const fileInputRef = useRef(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [canvasImage, setCanvasImage] = useState(null)
  const [checkerPattern, setCheckerPattern] = useState(null)
  const [cursorPos, setCursorPos] = useState(null)
  const [boxStart, setBoxStart] = useState(null)
  const [boxEnd, setBoxEnd] = useState(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [dashOffset, setDashOffset] = useState(0)
  const sampleCtxRef = useRef(null)

  // Keep canvasImage (HTMLImageElement) in sync with currentImage base64
  useEffect(() => {
    if (!currentImage) { setCanvasImage(null); return }
    const img = new Image()
    img.src = currentImage
    img.onload = () => setCanvasImage(img)
  }, [currentImage])

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (event) => {
        const src = event.target.result
        const img = new Image()
        img.onload = () => {
          useStore.getState().initImage(src)
        }
        img.src = src
      }
      reader.readAsDataURL(file)
    }
  }

  // Track container dimensions and create checkerboard pattern
  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        const r = containerRef.current.getBoundingClientRect()
        setDimensions({ width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) })
      }
    }
    update()
    window.addEventListener('resize', update)
    // create small checker pattern canvas
    const c = document.createElement('canvas')
    c.width = 20; c.height = 20
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#746f73'; ctx.fillRect(0, 0, 20, 20)
    ctx.fillStyle = '#4b474c'; ctx.fillRect(0, 0, 10, 10); ctx.fillRect(10, 10, 10, 10)
    setCheckerPattern(c)
    return () => window.removeEventListener('resize', update)
  }, [])

  // Compute how the image should be displayed inside the stage (centered with padding).
  const getImageDisplay = () => {
    if (!canvasImage) return { x: 0, y: 0, dw: 0, dh: 0, scale: 1 }
    const pad = 20
    const maxW = Math.max(1, dimensions.width - pad * 2)
    const maxH = Math.max(1, dimensions.height - pad * 2)
    // do not upscale, only downscale to fit within padded area
    const scale = Math.min(1, Math.min(maxW / canvasImage.width, maxH / canvasImage.height))
    const dw = Math.round(canvasImage.width * scale)
    const dh = Math.round(canvasImage.height * scale)
    const x = Math.round((dimensions.width - dw) / 2)
    const y = Math.round((dimensions.height - dh) / 2)
    return { x, y, dw, dh, scale }
  }

  const handleCanvasClick = async (e) => {
    if (!canvasImage || !activeTool) return

    const stage = e.target.getStage()
    const pos = stage.getPointerPosition()
    const shiftKey = e.evt?.shiftKey || false

    if (activeTool === 'crop') {
      // Initialize crop rect to full image
      const { x: imgXOffset, y: imgYOffset, dw, dh } = getImageDisplay()
      const sx = canvasImage.width / Math.max(1, dw)
      const sy = canvasImage.height / Math.max(1, dh)
      setCropRect({
        x: 0,
        y: 0,
        w: canvasImage.width,
        h: canvasImage.height
      })
      return
    }

    if (activeTool === 'magic-wand') {
      await handlePointSelect(e, { canvasImage, currentImage, getImageDisplay, toImageSpace, shiftKey })
      return
    }
  }

  // Debug: log when activeSelection changes
  useEffect(() => {
    if (activeSelection) {
      console.log('activeSelection updated:', activeSelection)
    }
  }, [activeSelection])

  // Debug: log lasso path and cursor
  useEffect(() => {
    if (activeTool === 'lasso' && lassoPath.length > 0) {
      console.log('lassoPath:', lassoPath, 'cursorPos:', cursorPos, 'isDrawing:', isDrawing)
    }
  }, [lassoPath, cursorPos, activeTool, isDrawing])

  const toImageSpace = (stagePos) => {
    if (!canvasImage) return { x: stagePos.x, y: stagePos.y }
    const { x: imgX, y: imgY, dw, dh } = getImageDisplay()
    const sx = canvasImage.width / Math.max(1, dw)
    const sy = canvasImage.height / Math.max(1, dh)
    // Convert stage position to image-space (account for image offset)
    const relX = stagePos.x - imgX
    const relY = stagePos.y - imgY
    return { x: Math.round(relX * sx), y: Math.round(relY * sy) }
  }

  const handleBoxMouseDown = (e) => {
    if (activeTool !== 'box') return
    const stage = e.target.getStage()
    const pos = stage.getPointerPosition()
    setBoxStart(pos)
    setBoxEnd(pos)
  }

  const handleBoxMouseMove = (e) => {
    if (activeTool !== 'box' || !boxStart) return
    const stage = e.target.getStage()
    const pos = stage.getPointerPosition()
    setBoxEnd(pos)
  }

  const handleBoxMouseUp = (e) => {
    if (activeTool !== 'box') return
    const shiftKey = e.evt?.shiftKey || false
    const stage = e.target.getStage()
    const pos = stage.getPointerPosition()
    selectBoxUp(pos, { boxStart, boxEnd, setBoxStart, setBoxEnd, canvasImage, getImageDisplay, shiftKey })
  }

  const handlePenMouseDown = (e) => {
    if (activeTool !== 'pen' && activeTool !== 'lasso' && activeTool !== 'image-eraser' && activeTool !== 'image-restorer') return
    const stage = e.target.getStage()
    const pos = stage.getPointerPosition()
    setIsDrawing(true)
    if (activeTool === 'pen') {
      // delegate pen logic to PenTool helpers
      const display = getImageDisplay()
      penMouseDown(pos, canvasImage, display)
    } else if (activeTool === 'lasso') {
      const ipos = toImageSpace(pos)
      addLassoPoint(ipos.x, ipos.y)
      setCursorPos(pos)
    } else if (activeTool === 'image-eraser') {
      startBgErase(pos, canvasImage, getImageDisplay)
    } else if (activeTool === 'image-restorer') {
      startBgRestore(pos, canvasImage, getImageDisplay)
    }
    if (activeTool === 'image-eraser' || activeTool === 'image-restorer') setCursorPos(pos)
  }

  useEffect(() => {
    if (canvasImage) {
      const off = document.createElement('canvas')
      off.width = canvasImage.width
      off.height = canvasImage.height
      const octx = off.getContext('2d')
      octx.drawImage(canvasImage, 0, 0)
      sampleCtxRef.current = octx
    }
  }, [canvasImage])

  const handlePenMouseMove = (e) => {
    const stage = e.target.getStage()
    const pos = stage.getPointerPosition()
    // track pointer for lasso only while drawing
    if (activeTool === 'lasso' && isDrawing) setCursorPos(pos)
    // Dropper sampling (works even when not drawing)
    if (activeTool === 'pen' && penDropper && canvasImage && sampleCtxRef.current) {
      const { x: imgXOffset, y: imgYOffset, dw, dh } = getImageDisplay()
      const sx = canvasImage.width / Math.max(1, dw)
      const sy = canvasImage.height / Math.max(1, dh)
      const ix = Math.min(canvasImage.width - 1, Math.max(0, Math.round((pos.x - imgXOffset) * sx)))
      const iy = Math.min(canvasImage.height - 1, Math.max(0, Math.round((pos.y - imgYOffset) * sy)))
      const data = sampleCtxRef.current.getImageData(ix, iy, 1, 1).data
      const hex = '#' + [data[0], data[1], data[2]].map(v => v.toString(16).padStart(2, '0')).join('')
      setPenColor(hex)
    }
    if (activeTool === 'image-eraser' || activeTool === 'image-restorer') setCursorPos(pos)
    if (!isDrawing) return
    if (activeTool === 'pen') {
      const display = getImageDisplay()
      penMouseMove(pos, canvasImage, display, isDrawing)
    } else if (activeTool === 'lasso') {
      const ipos = toImageSpace(pos)
      addLassoPoint(ipos.x, ipos.y)
    } else if (activeTool === 'image-eraser') {
      updateBgErase(pos, canvasImage, getImageDisplay)
    } else if (activeTool === 'image-restorer') {
      updateBgRestore(pos, canvasImage, getImageDisplay)
    }
  }

  const handlePenMouseUp = (e) => {
    if (!isDrawing) return
    const shiftKey = e.evt?.shiftKey || false
    setIsDrawing(false)
    if (activeTool === 'pen') penMouseUp()
    if (activeTool === 'image-eraser') asyncFinishBgErase()
    if (activeTool === 'image-restorer') asyncFinishBgRestore()
    if (activeTool === 'image-eraser' || activeTool === 'image-restorer') setCursorPos(null)
    if (activeTool === 'lasso' && lassoPath.length > 2 && canvasImage) {
      // Confirm selection from lasso path in image space if we can close the shape
      const imgW = canvasImage.width
      const imgH = canvasImage.height

      const dist2 = (a, b) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)
      const near = (a, b, thr) => dist2(a, b) <= thr * thr
      const onEdge = (p, pad = 1) => {
        if (p.x <= pad) return 'left'
        if (p.x >= imgW - pad) return 'right'
        if (p.y <= pad) return 'top'
        if (p.y >= imgH - pad) return 'bottom'
        return null
      }
      const first = lassoPath[0]
      const last = lassoPath[lassoPath.length - 1]

      let closedPoints = [...lassoPath]
      const closeThreshold = Math.max(6, Math.min(imgW, imgH) * 0.01)
      if (!near(first, last, closeThreshold)) {
        // Try closing via image borders if start/end lie on edges
        const sEdge = onEdge(first)
        const eEdge = onEdge(last)
        if (sEdge && eEdge) {
          // Project start/end to exact edge lines
          const clampToEdge = (p, edge) => {
            if (edge === 'left') return { x: 0, y: Math.max(0, Math.min(imgH, p.y)) }
            if (edge === 'right') return { x: imgW, y: Math.max(0, Math.min(imgH, p.y)) }
            if (edge === 'top') return { x: Math.max(0, Math.min(imgW, p.x)), y: 0 }
            if (edge === 'bottom') return { x: Math.max(0, Math.min(imgW, p.x)), y: imgH }
            return p
          }
          const s = clampToEdge(first, sEdge)
          const e = clampToEdge(last, eEdge)
          // Define corners in clockwise order starting at top-left
          const corners = [
            { x: 0, y: 0, edge: 'top-left' },
            { x: imgW, y: 0, edge: 'top-right' },
            { x: imgW, y: imgH, edge: 'bottom-right' },
            { x: 0, y: imgH, edge: 'bottom-left' },
          ]
          const edgeIndex = { top: 0, right: 1, bottom: 2, left: 3 }
          const sIdx = edgeIndex[sEdge]
          const eIdx = edgeIndex[eEdge]
          // Build border path moving clockwise from sEdge to eEdge
          const borderPath = [s]
          let idx = sIdx
          while (idx !== eIdx) {
            borderPath.push(corners[idx])
            idx = (idx + 1) % 4
          }
          borderPath.push(e)
          // Close by appending borderPath to lasso points
          closedPoints = [...lassoPath, ...borderPath]
        } else {
          // If we cannot close reliably, do not confirm selection
          closedPoints = null
        }
      }
      if (closedPoints) {
        const newSel = { type: 'lasso', points: closedPoints }
        // If shift is held, add to selections; otherwise replace
        if (shiftKey) {
          useStore.getState().addToActiveSelections(newSel)
        } else {
          setActiveSelection(newSel)
        }
        useStore.getState().resetLasso()
      }
    }
    // clear preview cursor for lasso after finishing
    if (activeTool === 'lasso') setCursorPos(null)
  }

  // Register stageRef in the global store so we can bake the visible canvas when needed
  useEffect(() => {
    try {
      if (stageRef && stageRef.current) useStore.getState().setStageRef(stageRef.current)
    } catch (e) {}
    return () => { try { useStore.getState().setStageRef(null) } catch (e) {} }
  }, [stageRef.current])

  // Animate dash offset (marching ants) only when there is a finalized active selection
  useEffect(() => {
    const shouldAnimate = !!activeSelection
    let raf = null
    let last = performance.now()
    const step = (t) => {
      // advance offset based on time to keep animation smooth
      const dt = t - last
      last = t
      setDashOffset(o => (o + Math.round(dt * 0.06)) % 1000)
      raf = requestAnimationFrame(step)
    }
    if (shouldAnimate) raf = requestAnimationFrame(step)
    return () => { if (raf) cancelAnimationFrame(raf) }
  }, [activeSelection])

  // Apply preset ratio to crop rect when preset changes
  useEffect(() => {
    if (!cropRect || cropPresetRatio === null || cropPresetRatio === undefined) return

    let newW = cropRect.w
    let newH = cropRect.h
    const currentRatio = newW / newH
    const targetRatio = cropPresetRatio

    // Adjust height to match the preset ratio (keep width)
    if (Math.abs(currentRatio - targetRatio) > 0.01) {
      newH = Math.round(newW / targetRatio)

      // If height exceeds image bounds, adjust width instead
      if (cropRect.y + newH > canvasImage.height) {
        newH = canvasImage.height - cropRect.y
        newW = Math.round(newH * targetRatio)
      }
    }

    setCropRect({ ...cropRect, w: newW, h: newH })
  }, [cropPresetRatio])

  return (
    <div className="canvas-container" ref={containerRef}>
      {/* Toast moved to a global component so it's visible on all pages */}
      {!currentImage ? (
        <div className="canvas-empty" onClick={() => fileInputRef.current?.click()} style={{ cursor: 'pointer' }}>
          <div className="empty-state">
            <div className="empty-icon"><ImageIcon size={100} /></div>
            <h3>No Image Loaded</h3>
            <p>Click anywhere to load an image</p>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
        </div>
      ) : (
        <Stage
          ref={stageRef}
          width={dimensions.width}
          height={dimensions.height}
          onClick={handleCanvasClick}
          onMouseDown={(e) => { handleBoxMouseDown(e); handlePenMouseDown(e); }}
          onMouseMove={(e) => { handleBoxMouseMove(e); handlePenMouseMove(e); }}
          onMouseUp={(e) => { handleBoxMouseUp(e); handlePenMouseUp(e); }}
          onTouchStart={(e) => { handleBoxMouseDown(e); handlePenMouseDown(e); }}
          onTouchMove={(e) => { handleBoxMouseMove(e); handlePenMouseMove(e); }}
          onTouchEnd={(e) => { handleBoxMouseUp(e); handlePenMouseUp(e); }}
          className={`canvas-stage ${activeTool === 'pen' && penDropper ? 'pen-dropper' : ''}`}
        >
          <Layer>
            {/* Checkerboard shown only under the image area */}
            {checkerPattern && (
              <Rect
                x={0}
                y={0}
                width={dimensions.width}
                height={dimensions.height}
                fillPatternImage={checkerPattern}
                fillPatternRepeat="repeat"
                listening={false}
              />
            )}
            {canvasImage && (() => {
              const { x: imgXOffset, y: imgYOffset, dw, dh } = getImageDisplay()
              return <KonvaImage image={canvasImage} x={imgXOffset} y={imgYOffset} width={dw} height={dh} listening={false} />
            })()}
            {cursorPos && (activeTool === 'image-eraser' || activeTool === 'image-restorer') && (
                <Circle
                x={cursorPos.x}
                y={cursorPos.y}
                radius={(activeTool === 'image-eraser' ? bgEraserSize : useStore.getState().bgRestorerSize)}
                stroke="#D7CBFF"
                strokeWidth={1}
                dash={[4, 4]}
                listening={false}
              />
            )}
            {/* Lasso pointer preview - small filled circle */}
            {cursorPos && activeTool === 'lasso' && (
              <Circle
                x={cursorPos.x}
                y={cursorPos.y}
                radius={3}
                fill="#e9e6ff"
                listening={false}
              />
            )}

            {/* Selection points (map from image-space -> stage-space) */}
            {selectionPoints.map((point, i) => {
              if (!canvasImage) return null
              const { x: imgXOffset, y: imgYOffset, dw, dh } = getImageDisplay()
              const sx = dw / canvasImage.width
              const sy = dh / canvasImage.height
              return (
                <Circle
                  key={i}
                  x={imgXOffset + point.x * sx}
                  y={imgYOffset + point.y * sy}
                  radius={5}
                  fill={point.label === 1 ? '#00ff00' : '#ff0000'}
                  stroke="#D7CBFF"
                  strokeWidth={2}
                  listening={false}
                />
              )
            })}

            {/* Box selection */}
            {boxStart && boxEnd && (
                <Rect
                x={Math.min(boxStart.x, boxEnd.x)}
                y={Math.min(boxStart.y, boxEnd.y)}
                width={Math.abs(boxEnd.x - boxStart.x)}
                height={Math.abs(boxEnd.y - boxStart.y)}
                stroke="#e9e6ff"
                strokeWidth={2}
                dash={[6, 4]}
                listening={false}
              />
            )}
            {activeTool === 'crop' && (
              <CropTool canvasImage={canvasImage} getImageDisplay={getImageDisplay} />
            )}
            {/* Pen tool strokes rendered via PenStrokesRenderer */}
            <PenStrokesRenderer canvasImage={canvasImage} display={getImageDisplay()} />
            {/* Live lasso preview while dragging */}
            {activeTool === 'lasso' && lassoPath.length > 0 && canvasImage && (() => {
              const { x: imgXOffset, y: imgYOffset, dw, dh } = getImageDisplay()
              const sx = dw / canvasImage.width
              const sy = dh / canvasImage.height
              const lassoPoints = lassoPath.flatMap(p => [imgXOffset + p.x * sx, imgYOffset + p.y * sy])
              // Add live line from last point to cursor
              let allPoints = lassoPoints
              if (cursorPos && lassoPath.length > 0) {
                allPoints = [...lassoPoints, cursorPos.x, cursorPos.y]
              }
              return (
                <Line
                  points={allPoints}
                  stroke="#e9e6ff"
                  strokeWidth={2}
                  dash={[6, 4]}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
              )
            })()}
            {/* All active selections outlines (multi-select) */}
            {canvasImage && useStore.getState().activeSelections && useStore.getState().activeSelections.map((sel, idx) => {
              if (sel.type === 'lasso') {
                return (
                  <Group key={idx}>
                    {(() => {
                      const { x: imgXOffset, y: imgYOffset, dw, dh } = getImageDisplay()
                      const sx = dw / canvasImage.width
                      const sy = dh / canvasImage.height
                      return (
                        <Line
                          points={sel.points.flatMap(p => [imgXOffset + p.x * sx, imgYOffset + p.y * sy])}
                          stroke="#e9e6ff"
                          strokeWidth={2}
                          dash={[6, 4]}
                          dashOffset={dashOffset}
                          closed={true}
                          listening={false}
                        />
                      )
                    })()}
                  </Group>
                )
              } else if (sel.type === 'box') {
                return (
                  <Group key={idx}>
                    {(() => {
                      const { x: imgXOffset, y: imgYOffset, dw, dh } = getImageDisplay()
                      const sx = dw / canvasImage.width
                      const sy = dh / canvasImage.height
                      return (
                        <Rect
                          x={imgXOffset + sel.box.x * sx}
                          y={imgYOffset + sel.box.y * sy}
                          width={sel.box.w * sx}
                          height={sel.box.h * sy}
                          stroke="#e9e6ff"
                          strokeWidth={2}
                          dash={[6, 4]}
                          dashOffset={dashOffset}
                          listening={false}
                        />
                      )
                    })()}
                  </Group>
                )
              }
              return null
            })}
            {/* Active selection outline (current/last) */}
            {activeSelection && canvasImage && activeSelection.type === 'lasso' && (() => {
              const { x: imgXOffset, y: imgYOffset, dw, dh } = getImageDisplay()
              const sx = dw / canvasImage.width
              const sy = dh / canvasImage.height
              return (
                <Line
                  points={activeSelection.points.flatMap(p => [imgXOffset + p.x * sx, imgYOffset + p.y * sy])}
                  stroke="#e9e6ff"
                  strokeWidth={2}
                  dash={[6, 4]}
                  dashOffset={dashOffset}
                  closed={true}
                  listening={false}
                />
              )
            })()}
            {activeSelection && canvasImage && activeSelection.type === 'box' && (() => {
              const { x: imgXOffset, y: imgYOffset, dw, dh } = getImageDisplay()
              const sx = dw / canvasImage.width
              const sy = dh / canvasImage.height
              return (
                <Rect
                  x={imgXOffset + activeSelection.box.x * sx}
                  y={imgYOffset + activeSelection.box.y * sy}
                  width={activeSelection.box.w * sx}
                  height={activeSelection.box.h * sy}
                  stroke="#e9e6ff"
                  strokeWidth={2}
                  dash={[6, 4]}
                  dashOffset={dashOffset}
                  listening={false}
                />
              )
            })()}
          </Layer>
        </Stage>
      )}
    </div>
  )
}

export default Canvas