import React from 'react'
import { Line, Circle } from 'react-konva'
import { useStore } from '../../store/useStore'

// Pen tool helpers: convert stage coords -> image-space, add/erase points, finalize
export function penMouseDown(pos, canvasImage, display) {
  const state = useStore.getState()
  if (!canvasImage || !display) return
  const { x: imgXOffset, y: imgYOffset, dw, dh } = display
  const sx = canvasImage.width / Math.max(1, dw)
  const sy = canvasImage.height / Math.max(1, dh)
  const imgX = Math.round((pos.x - imgXOffset) * sx)
  const imgY = Math.round((pos.y - imgYOffset) * sy)
  const sizeImg = Math.round(state.penSize * Math.max(sx, sy))
  if (state.penMode === 'draw') state.addStrokePoint(imgX, imgY, sizeImg)
  else state.eraseStrokeAt(imgX, imgY)
}

export function penMouseMove(pos, canvasImage, display, isDrawing) {
  if (!isDrawing) return
  const state = useStore.getState()
  if (!canvasImage || !display) return
  const { x: imgXOffset, y: imgYOffset, dw, dh } = display
  const sx = canvasImage.width / Math.max(1, dw)
  const sy = canvasImage.height / Math.max(1, dh)
  const imgX = Math.round((pos.x - imgXOffset) * sx)
  const imgY = Math.round((pos.y - imgYOffset) * sy)
  const sizeImg = Math.round(state.penSize * Math.max(sx, sy))
  if (state.penMode === 'draw') state.addStrokePoint(imgX, imgY, sizeImg)
  else state.eraseStrokeAt(imgX, imgY)
}

export function penMouseUp() {
  const state = useStore.getState()
  if (state.penMode === 'draw') state.finalizeStroke()
  state.endPenSession()
}

// Renderer for pen strokes (expects strokes stored in image-space coordinates)
export function PenStrokesRenderer({ canvasImage, display }) {
  const drawingStrokes = useStore((s) => s.drawingStrokes)
  if (!drawingStrokes || drawingStrokes.length === 0 || !canvasImage || !display) return null
  const { x: imgXOffset, y: imgYOffset, dw, dh } = display
  return (
    <>
      {drawingStrokes.map((stroke) => {
        const pts = stroke.points.flatMap(p => [imgXOffset + (p.x / canvasImage.width) * dw, imgYOffset + (p.y / canvasImage.height) * dh])
        const strokeWidthStage = Math.max(1, Math.round(stroke.size * Math.max(dw / canvasImage.width, dh / canvasImage.height)))
        return (
          <Line
            key={stroke.id}
            points={pts}
            stroke={stroke.color}
            strokeWidth={strokeWidthStage}
            tension={0.5}
            lineCap="round"
            lineJoin="round"
            listening={false}
          />
        )
      })}
    </>
  )
}

// Small helper to render pen cursor when needed
export function PenCursor({ pos, size }) {
  if (!pos) return null
  return <Circle x={pos.x} y={pos.y} radius={size} stroke="#D7CBFF" strokeWidth={1} dash={[4,4]} listening={false} />
}

export default PenStrokesRenderer
