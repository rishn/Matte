import React, { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronUp, RotateCcw, Sun, Thermometer, Droplets, SlidersHorizontal, SunSnow, Contrast, Moon, Zap, Aperture, Grid } from 'lucide-react'
import { useStore } from '../store/useStore'
import { getFilters } from '../services/api'
import { composeImage } from '../utils/compositor'
import './PropertiesPanel.css'

function PropertiesPanel() {
  const { 
    baseImage,
    layers,
    activeLayerId,
    setActiveLayer,
    createFilterLayer,
    removeLayer,
    createAdjustmentLayer,
    setLayerFilterPreset,
    setLayerFilterAmount,
    setLayerFilterCachedResult,
    setAdjustmentLayerValue,
    commitCurrentImage,
    setIsProcessing,
    recomputeComposite,
    pushHistorySnapshot,
  } = useStore()

  const [expandedSections, setExpandedSections] = useState({
    adjustments: true,
    filters: true
  })
  const [filters, setFilters] = useState([])
  const debounceRef = useRef(null)

  useEffect(() => {
    // Load available filters
    getFilters().then(setFilters).catch(console.error)
  }, [])

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  // Adjustment layer kinds metadata
  const adjustmentKinds = [
    { kind: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1 },
    { kind: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1 },
    { kind: 'exposure', label: 'Exposure', min: -2, max: 2, step: 0.1 },
    { kind: 'saturation', label: 'Vibrance', min: -100, max: 100, step: 1 },
    { kind: 'temperature', label: 'Temp', min: -100, max: 100, step: 1 },
    { kind: 'tint', label: 'Tint', min: -100, max: 100, step: 1 },
    { kind: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1 },
    { kind: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1 },
    { kind: 'vignette', label: 'Vignette', min: 0, max: 100, step: 1 },
    { kind: 'sharpness', label: 'Sharpness', min: 0, max: 100, step: 1 },
  ]

  const activeAdjustmentLayer = layers.find(l => l.id === activeLayerId && l.type === 'adjustment')
  const activeFilterLayer = layers.find(l => l.id === activeLayerId && l.type === 'filter')

  const handleSelectAdjustmentKind = (kind) => {
    // If clicking same kind and layer exists, just activate
    const existing = layers.find(l => l.type === 'adjustment' && l.config.kind === kind)
    if (existing) {
      setActiveLayer(existing.id)
      return
    }
    createAdjustmentLayer(kind)
    // After creation, recomposition will occur when value changes
  }

  const handleAdjustmentValueChange = (value) => {
    if (!activeAdjustmentLayer) return
    setAdjustmentLayerValue(activeAdjustmentLayer.id, value)
    // Debounce compose
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      recomputeComposite()
    }, 120)
  }

  const handleAdjustmentValueCommit = () => {
    recomputeComposite()
    commitCurrentImage()
  }

  const handleSelectFilterPreset = async (preset) => {
    // If there is an active filter layer with same preset just activate it
    const existing = layers.find(l => l.type === 'filter' && l.config.preset === preset)
    if (existing) {
      setActiveLayer(existing.id)
      return
    }
    // Create the filter layer and activate it so it appears in the Layers panel.
    // Do not auto-bake or remove the layer; let the user manage it like other layers.
    try {
      const newId = createFilterLayer(preset)
      // Ensure the new filter is visible immediately
      await recomputeComposite()
      // Record this creation in history so undo/redo include the new filter layer
      try { if (typeof pushHistorySnapshot === 'function') pushHistorySnapshot() } catch (e) {}
      // Activate the created layer explicitly (store.createFilterLayer also sets activeLayerId,
      // but we set it here to be explicit about intent)
      setActiveLayer(newId)
    } catch (e) {
      console.error('Filter preset error:', e)
    }
  }

  const handleFilterAmountChange = (amount) => {
    if (!activeFilterLayer) return
    setLayerFilterAmount(activeFilterLayer.id, amount)
  }

  const handleFilterCommit = () => {
    recomputeComposite()
    commitCurrentImage()
  }

  const handleReset = () => {
    // No global reset now; user removes layers instead
  }

  // Filter swatch gradients
  const gradientMap = {
    vintage: 'linear-gradient(45deg,#a67c52,#f5deb3)',
    cinematic: 'linear-gradient(45deg,#0e7490,#f97316)',
    bw: 'linear-gradient(45deg,#000,#D7CBFF)',
    warm: 'linear-gradient(45deg,#ff8c00,#ffd700)',
    cool: 'linear-gradient(45deg,#3b82f6,#06b6d4)',
    dramatic: 'linear-gradient(45deg,#111827,#374151)',
    soft: 'linear-gradient(45deg,#fecdd3,#fde68a)',
    vivid: 'linear-gradient(45deg,#ef4444,#22c55e)',
    sepia: 'linear-gradient(45deg,#704214,#c0a080)',
    fade: 'linear-gradient(45deg,#cbd5e1,#e5e7eb)',
  }

  return (
    <div className="properties-panel">
      <div className="panel-header">
        <h3>Properties</h3>
      </div>

      {/* Filters Section */}
      <div className="panel-section">
        <button className="section-header" onClick={() => toggleSection('filters')}>
          <span>Filters</span>
          {expandedSections.filters ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {expandedSections.filters && (
          <div className="section-content">
            <div className="filters-grid">
              {filters.map(f => (
                <button
                  key={f.id}
                  className={`filter-swatch ${activeFilterLayer?.config.preset === f.id ? 'selected' : ''}`}
                  style={{ background: gradientMap[f.id] }}
                  onClick={() => handleSelectFilterPreset(f.id)}
                  title={f.description}
                >
                  <span className="filter-swatch-label">{f.name}</span>
                </button>
              ))}
            </div>
            {activeFilterLayer && (
              <div className="filter-amount">
                <label>Intensity</label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={activeFilterLayer.config.amount}
                  onChange={(e) => handleFilterAmountChange(parseInt(e.target.value, 10))}
                  onMouseUp={handleFilterCommit}
                  onTouchEnd={handleFilterCommit}
                />
                <span className="control-value">{activeFilterLayer.config.amount}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Adjustments Section */}
      <div className="panel-section">
        <button className="section-header" onClick={() => toggleSection('adjustments')}>
          <span>Adjustments</span>
          {expandedSections.adjustments ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {expandedSections.adjustments && (
          <div className="section-content">
            <div className="adjustments-grid">
              {adjustmentKinds.map(a => (
                <button
                  key={a.kind}
                  className={`adjustment-icon ${activeAdjustmentLayer?.config.kind === a.kind ? 'selected' : ''}`}
                  onClick={() => handleSelectAdjustmentKind(a.kind)}
                  title={a.label}
                >
                  {a.kind === 'brightness' ? <Sun size={16} />
                    : a.kind === 'contrast' ? <Contrast size={16} />
                    : a.kind === 'exposure' ? <Zap size={16} />
                    : a.kind === 'saturation' ? <Droplets size={16} />
                    : a.kind === 'temperature' ? <Thermometer size={16} />
                    : a.kind === 'tint' ? <SunSnow size={16} />
                    : a.kind === 'highlights' ? <Sun size={16} />
                    : a.kind === 'shadows' ? <Moon size={16} />
                    : a.kind === 'vignette' ? <Aperture size={16} />
                    : a.kind === 'sharpness' ? <Grid size={16} />
                    : null}
                  <span className="adjustment-icon-label">{a.label}</span>
                </button>
              ))}
            </div>
            {activeAdjustmentLayer && (
              <div className="adjustment-slider">
                <label>{activeAdjustmentLayer.name}</label>
                {(() => {
                  const meta = adjustmentKinds.find(m => m.kind === activeAdjustmentLayer.config.kind)
                  if (!meta) return null
                  return (
                    <>
                      <input
                        type="range"
                        min={meta.min}
                        max={meta.max}
                        step={meta.step}
                        value={activeAdjustmentLayer.config.value}
                        onChange={(e) => handleAdjustmentValueChange(parseFloat(e.target.value))}
                        onMouseUp={handleAdjustmentValueCommit}
                        onTouchEnd={handleAdjustmentValueCommit}
                      />
                      <span className="control-value">{activeAdjustmentLayer.config.value.toFixed(meta.step < 1 ? 1 : 0)}</span>
                    </>
                  )
                })()}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default PropertiesPanel
