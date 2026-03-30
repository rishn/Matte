import React, { useRef, useState } from 'react'
import { Eye, EyeOff, Trash2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import './LayersPanel.css'

function LayersPanel() {
  const { layers, activeLayerId, setActiveLayer, setLayerVisibility, removeLayer, reorderLayers } = useStore()
  const dragIndexRef = useRef(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)

  const onDragStart = (idx) => {
    dragIndexRef.current = idx
  }
  const onDragOver = (idx, e) => {
    e.preventDefault()
    setDragOverIndex(idx)
  }
  const onDrop = (idx) => {
    const from = dragIndexRef.current
    const to = idx
    dragIndexRef.current = null
    setDragOverIndex(null)
    if (from != null && to != null) {
      reorderLayers(from, to)
    }
  }

  const renderSwatch = (layer) => {
    if (layer.type === 'filter') {
      const preset = layer.config?.preset
      const style = { width: 24, height: 24, borderRadius: 4 }
      const gradientMap = {
        vintage: 'linear-gradient(45deg, #a67c52, #f5deb3)',
        cinematic: 'linear-gradient(45deg, #0e7490, #f97316)',
        bw: 'linear-gradient(45deg, #000000, #D7CBFF)',
        warm: 'linear-gradient(45deg, #ff8c00, #ffd700)',
        cool: 'linear-gradient(45deg, #3b82f6, #06b6d4)',
        dramatic: 'linear-gradient(45deg, #111827, #374151)',
        soft: 'linear-gradient(45deg, #fecdd3, #fde68a)',
        vivid: 'linear-gradient(45deg, #ef4444, #22c55e)',
        sepia: 'linear-gradient(45deg, #704214, #c0a080)',
        fade: 'linear-gradient(45deg, #cbd5e1, #e5e7eb)'
      }
      return <div style={{ ...style, background: gradientMap[preset] || '#ccc' }} />
    }
    if (layer.type === 'adjustments') {
      return <div style={{ width: 24, height: 24, borderRadius: 4, background: '#9ca3af' }} />
    }
    return <div style={{ width: 24, height: 24, borderRadius: 4, background: '#ccc' }} />
  }

  return (
    <div className="layers-panel">
      <div className="panel-header">
        <h3>Layers</h3>
      </div>
      
      <div className="layers-list">
        {layers.filter(l => l.type !== 'selection').map((layer, idx) => (
          <div
            key={layer.id}
            className={`layer-item ${activeLayerId === layer.id ? 'active' : ''} ${dragOverIndex === idx ? 'drag-over' : ''}`}
            draggable
            onDragStart={() => onDragStart(idx)}
            onDragOver={(e) => onDragOver(idx, e)}
            onDrop={() => onDrop(idx)}
            onClick={() => setActiveLayer(layer.id)}
          >
            <div className="layer-thumbnail">
              {renderSwatch(layer)}
            </div>
            <div className="layer-info">
              <span className="layer-name">{layer.name}</span>
            </div>
            <div className="layer-controls">
              <button 
                className="layer-control-btn"
                onClick={(e) => { e.stopPropagation(); setLayerVisibility(layer.id, !layer.visible) }}
                title={layer.visible ? 'Hide' : 'Show'}
              >
                {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              {layers.length > 1 && (
                <button 
                  className="layer-control-btn"
                  onClick={(e) => { e.stopPropagation(); removeLayer(layer.id) }}
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default LayersPanel
