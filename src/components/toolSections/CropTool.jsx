import React, { useEffect } from 'react'
import { Rect, Group, Line, Circle, Text } from 'react-konva'
import { useStore } from '../../store/useStore'

// CropTool component extracts crop-related logic from Canvas
export default function CropTool({ canvasImage, getImageDisplay }) {
  const { cropRect, setCropRect, cropPresetRatio, aspectLock } = useStore()

  // Apply preset ratio to crop rect when preset changes
  useEffect(() => {
    if (!cropRect || cropPresetRatio === null || cropPresetRatio === undefined) return
    if (!canvasImage) return

    let newW = cropRect.w
    let newH = cropRect.h
    const targetRatio = cropPresetRatio

    // Adjust height to match the preset ratio (keep width)
    if (Math.abs((newW / newH) - targetRatio) > 0.01) {
      newH = Math.round(newW / targetRatio)

      // If height exceeds image bounds, adjust width instead
      if (cropRect.y + newH > canvasImage.height) {
        newH = canvasImage.height - cropRect.y
        newW = Math.round(newH * targetRatio)
      }
    }

    setCropRect({ ...cropRect, w: newW, h: newH })
  }, [cropPresetRatio])

  const handleCropHandleDrag = (handle, pos) => {
    if (!cropRect || !canvasImage) return
    const { x: imgXOffset, y: imgYOffset, dw, dh } = getImageDisplay()
    const sx = canvasImage.width / Math.max(1, dw)
    const sy = canvasImage.height / Math.max(1, dh)
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
    const imgX = clamp(Math.round((pos.x - imgXOffset) * sx), 0, canvasImage.width)
    const imgY = clamp(Math.round((pos.y - imgYOffset) * sy), 0, canvasImage.height)
    let { x, y, w, h } = cropRect
    const minSize = 20
    let left = x
    let top = y
    let right = x + w
    let bottom = y + h

    switch (handle) {
      case 'left': left = imgX; break
      case 'right': right = imgX; break
      case 'top': top = imgY; break
      case 'bottom': bottom = imgY; break
      case 'tl': left = imgX; top = imgY; break
      case 'tr': right = imgX; top = imgY; break
      case 'bl': left = imgX; bottom = imgY; break
      case 'br': right = imgX; bottom = imgY; break
      default: break
    }

    const newLeft = Math.max(0, Math.min(left, right))
    const newRight = Math.min(canvasImage.width, Math.max(left, right))
    const newTop = Math.max(0, Math.min(top, bottom))
    const newBottom = Math.min(canvasImage.height, Math.max(top, bottom))

    let newW = Math.max(minSize, newRight - newLeft)
    let newH = Math.max(minSize, newBottom - newTop)

    if (cropPresetRatio !== null && cropPresetRatio !== undefined) {
      const targetRatio = cropPresetRatio
      const currentRatio = newW / newH
      if (Math.abs(currentRatio - targetRatio) > 0.01) {
        if (['right', 'left', 'tr', 'tl', 'br', 'bl'].includes(handle)) {
          newH = Math.round(newW / targetRatio)
          if (newH < minSize) {
            newH = minSize
            newW = Math.round(newH * targetRatio)
          }
          if (newTop + newH > canvasImage.height) {
            newH = canvasImage.height - newTop
            newW = Math.round(newH * targetRatio)
          }
        } else {
          newW = Math.round(newH * targetRatio)
          if (newW < minSize) {
            newW = minSize
            newH = Math.round(newW / targetRatio)
          }
          if (newLeft + newW > canvasImage.width) {
            newW = canvasImage.width - newLeft
            newH = Math.round(newW / targetRatio)
          }
        }
      }
    } else if (aspectLock) {
      const currentRatio = cropRect.w / cropRect.h
      const newRatio = newW / newH
      if (Math.abs(newRatio - currentRatio) > 0.01) {
        newH = Math.round(newW / currentRatio)
        if (newH < minSize) {
          newH = minSize
          newW = Math.round(newH * currentRatio)
        }
      }
    }

    setCropRect({ x: Math.round(newLeft), y: Math.round(newTop), w: Math.round(newW), h: Math.round(newH) })
  }

  const applyCrop = () => {
    if (!cropRect) return
    const base = useStore.getState().baseImage || useStore.getState().originalImageBase64
    if (!base) return
    const img = new window.Image()
    img.src = base
    img.onload = () => {
      const { x, y, w, h } = cropRect
      const out = document.createElement('canvas')
      out.width = Math.max(1, w)
      out.height = Math.max(1, h)
      const ctx = out.getContext('2d')
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h)
      const dataUrl = out.toDataURL('image/png')
      useStore.getState().setImage(dataUrl, true)
      useStore.getState().setCropRect(null)
    }
  }

  if (!canvasImage || !cropRect) return null

  const { x: imgXOffset, y: imgYOffset, dw, dh } = getImageDisplay()
  const sx = canvasImage.width / Math.max(1, dw)
  const sy = canvasImage.height / Math.max(1, dh)
  const rectStage = {
    x: imgXOffset + cropRect.x / sx,
    y: imgYOffset + cropRect.y / sy,
    w: cropRect.w / sx,
    h: cropRect.h / sy,
  }

  const len = 20
  const half = Math.round(len / 2)
  const cx = rectStage.x + rectStage.w / 2
  const cy = rectStage.y + rectStage.h / 2

  const makeBound = (handleId) => (p) => {
    const clamp = (v, a, b) => Math.max(a, Math.min(v, b))
    if (!handleId) return { x: clamp(p.x, imgXOffset, imgXOffset + dw), y: clamp(p.y, imgYOffset, imgYOffset + dh) }
    if (handleId === 'top' || handleId === 'bottom') {
      return { x: cx, y: clamp(p.y, imgYOffset, imgYOffset + dh) }
    }
    if (handleId === 'left' || handleId === 'right') {
      return { x: clamp(p.x, imgXOffset, imgXOffset + dw), y: cy }
    }
    return { x: clamp(p.x, imgXOffset, imgXOffset + dw), y: clamp(p.y, imgYOffset, imgYOffset + dh) }
  }

  const stageContainerCursor = (e, cursor) => {
    const stage = e.target.getStage()
    if (stage && stage.container()) stage.container().style.cursor = cursor
  }

  return (
    <>
      <Rect
        x={rectStage.x}
        y={rectStage.y}
        width={rectStage.w}
        height={rectStage.h}
          stroke="#D7CBFF"
        strokeWidth={2}
        dash={[4,4]}
        draggable
        dragBoundFunc={(p) => ({
          x: Math.max(imgXOffset, Math.min(p.x, imgXOffset + dw - rectStage.w)),
          y: Math.max(imgYOffset, Math.min(p.y, imgYOffset + dh - rectStage.h))
        })}
        onDragMove={(e) => {
          const pos = e.target.position()
          const newX = Math.round((pos.x - imgXOffset) * sx)
          const newY = Math.round((pos.y - imgYOffset) * sy)
          setCropRect({ x: newX, y: newY, w: cropRect.w, h: cropRect.h })
        }}
        onDblClick={() => applyCrop()}
      />

      {/* Handles */}
      <Group
        x={cx}
        y={rectStage.y}
        draggable
        dragBoundFunc={makeBound('top')}
        onDragMove={(e) => handleCropHandleDrag('top', e.target.position())}
        onDragEnd={(e) => handleCropHandleDrag('top', e.target.position())}
        onMouseEnter={(e) => stageContainerCursor(e, 'ns-resize')}
        onMouseLeave={(e) => stageContainerCursor(e, 'default')}
      >
          <Line points={[0,0,half,0]} stroke="#D7CBFF" strokeWidth={4} lineCap="square" />
      </Group>

      <Group
        x={cx}
        y={rectStage.y + rectStage.h}
        draggable
        dragBoundFunc={makeBound('bottom')}
        onDragMove={(e) => handleCropHandleDrag('bottom', e.target.position())}
        onDragEnd={(e) => handleCropHandleDrag('bottom', e.target.position())}
        onMouseEnter={(e) => stageContainerCursor(e, 'ns-resize')}
        onMouseLeave={(e) => stageContainerCursor(e, 'default')}
      >
          <Line points={[0,0,half,0]} stroke="#D7CBFF" strokeWidth={4} lineCap="square" />
      </Group>

      <Group
        x={rectStage.x}
        y={cy}
        draggable
        dragBoundFunc={makeBound('left')}
        onDragMove={(e) => handleCropHandleDrag('left', e.target.position())}
        onDragEnd={(e) => handleCropHandleDrag('left', e.target.position())}
        onMouseEnter={(e) => stageContainerCursor(e, 'ew-resize')}
        onMouseLeave={(e) => stageContainerCursor(e, 'default')}
      >
          <Line points={[0,-half,0,0]} stroke="#D7CBFF" strokeWidth={4} lineCap="square" />
      </Group>

      <Group
        x={rectStage.x + rectStage.w}
        y={cy}
        draggable
        dragBoundFunc={makeBound('right')}
        onDragMove={(e) => handleCropHandleDrag('right', e.target.position())}
        onDragEnd={(e) => handleCropHandleDrag('right', e.target.position())}
        onMouseEnter={(e) => stageContainerCursor(e, 'ew-resize')}
        onMouseLeave={(e) => stageContainerCursor(e, 'default')}
      >
          <Line points={[0,-half,0,0]} stroke="#D7CBFF" strokeWidth={4} lineCap="square" />
      </Group>

      {/* Corners */}
      <Group
        x={rectStage.x}
        y={rectStage.y}
        draggable
        dragBoundFunc={makeBound('tl')}
        onDragMove={(e) => handleCropHandleDrag('tl', e.target.position())}
        onDragEnd={(e) => handleCropHandleDrag('tl', e.target.position())}
        onMouseEnter={(e) => stageContainerCursor(e, 'nwse-resize')}
        onMouseLeave={(e) => stageContainerCursor(e, 'default')}
      >
          <Line points={[0,0,half,0]} stroke="#D7CBFF" strokeWidth={4} lineCap="square" />
          <Line points={[0,0,0,half]} stroke="#D7CBFF" strokeWidth={4} lineCap="square" />
      </Group>

      <Group
        x={rectStage.x + rectStage.w}
        y={rectStage.y}
        draggable
        dragBoundFunc={makeBound('tr')}
        onDragMove={(e) => handleCropHandleDrag('tr', e.target.position())}
        onDragEnd={(e) => handleCropHandleDrag('tr', e.target.position())}
        onMouseEnter={(e) => stageContainerCursor(e, 'nesw-resize')}
        onMouseLeave={(e) => stageContainerCursor(e, 'default')}
      >
          <Line points={[-half,0,0,0]} stroke="#D7CBFF" strokeWidth={4} lineCap="square" />
          <Line points={[0,0,0,half]} stroke="#D7CBFF" strokeWidth={4} lineCap="square" />
      </Group>

      <Group
        x={rectStage.x}
        y={rectStage.y + rectStage.h}
        draggable
        dragBoundFunc={makeBound('bl')}
        onDragMove={(e) => handleCropHandleDrag('bl', e.target.position())}
        onDragEnd={(e) => handleCropHandleDrag('bl', e.target.position())}
        onMouseEnter={(e) => stageContainerCursor(e, 'nesw-resize')}
        onMouseLeave={(e) => stageContainerCursor(e, 'default')}
      >
          <Line points={[0,-half,0,0]} stroke="#D7CBFF" strokeWidth={4} lineCap="square" />
          <Line points={[0,0,half,0]} stroke="#D7CBFF" strokeWidth={4} lineCap="square" />
      </Group>

      <Group
        x={rectStage.x + rectStage.w}
        y={rectStage.y + rectStage.h}
        draggable
        dragBoundFunc={makeBound('br')}
        onDragMove={(e) => handleCropHandleDrag('br', e.target.position())}
        onDragEnd={(e) => handleCropHandleDrag('br', e.target.position())}
        onMouseEnter={(e) => stageContainerCursor(e, 'nwse-resize')}
        onMouseLeave={(e) => stageContainerCursor(e, 'default')}
      >
          <Line points={[-half,0,0,0]} stroke="#D7CBFF" strokeWidth={4} lineCap="square" />
          <Line points={[0,-half,0,0]} stroke="#D7CBFF" strokeWidth={4} lineCap="square" />
      </Group>
      
    </>
  )
}
