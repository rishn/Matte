import React, { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { Wand2, Square, Crop, Check, Eraser, Pencil, Scissors, Pen, Undo2 as Restore, Save, Sparkles, Maximize2, Trash2, Repeat } from 'lucide-react'
import { autoSegmentBase64 } from '../services/api'
import { useStore } from '../store/useStore'
import useAuth from '../hooks/useAuth'
import { autoRemoveBackground } from './toolSections/MaskTools'
import './ToolsPanel.css'

// Move Image Eraser to top and add Image Restorer below it
const tools = [
  { id: 'remove-bg', name: 'Remove Background', icon: Sparkles },
  { id: 'image-eraser', name: 'Image Eraser', icon: Eraser },
  { id: 'magic-wand', name: 'Point Select', icon: Wand2 },
  { id: 'lasso', name: 'Freehand Select', icon: Scissors },
  { id: 'box', name: 'Box Select', icon: Square },
  { id: 'crop', name: 'Crop', icon: Crop },
  { id: 'pen', name: 'Pen', icon: Pencil },
]

function ToolsPanel() {
  const [showPresetDropdown, setShowPresetDropdown] = useState(false)
  const { activeTool, setActiveTool, aspectLock, setAspectLock, cropRect, setCropRect, applyCrop, currentImage, baseImage,
    penColor, setPenColor, penSize, setPenSize, penMode, setPenMode,
    bgEraserSize, setBgEraserSize, bgRestorerSize, setBgRestorerSize, bgRestorerFeather, setBgRestorerFeather,
    activeSelection, activeSelections, removeSelection, clearActiveSelection, clearActiveSelections, resetLasso,
    setImage, setMask, setIsProcessing, showToast, hideToast, cropPresetRatio, setCropPresetRatio,
    hasStagedRemoval, saveStagedRemoval, discardStagedRemoval, restorerParent, setRestorerParent, setActivePage } = useStore()
  const { setAuthMessage } = useStore()

  const { user } = useAuth()

  const presetRatios = [
    { label: 'Free', ratio: null },
    { label: '1:1', ratio: 1 },
    { label: '16:9', ratio: 16 / 9 },
    { label: '4:3', ratio: 4 / 3 },
    { label: '3:2', ratio: 3 / 2 },
    { label: '5:4', ratio: 5 / 4 },
    { label: '2:3', ratio: 2 / 3 },
  ]

  const handleSelectTool = (id) => {
    console.debug('[ToolsPanel] handleSelectTool', { id, activeTool, cropRect })
    // If the user is not signed in, guard certain tools and send to login
    if (!user && (id === 'remove-bg' || id === 'magic-wand')) {
      // redirect to login page with context
      if (id === 'remove-bg') setAuthMessage('Sign in to use Auto-remove Background and other AI tools')
      if (id === 'magic-wand') setAuthMessage('Sign in to use Point Select and other AI tools')
      setActivePage('login')
      return
    }
    // If user exists but hasn't verified email, block access to sensitive AI tools
    if (user && user.emailVerified === false && (id === 'remove-bg' || id === 'magic-wand')) {
      if (id === 'remove-bg') alert('Please verify your email before using Auto-remove Background')
      if (id === 'magic-wand') alert('Please verify your email before using Point Select')
      return
    }
    // Special-case the remove background quick action: do not change active tool, just run
    if (id === 'remove-bg') {
      handleRemoveBackground()
      return
    }

    // If clicking the eraser parent while restorer subtool (from eraser) is active, close the eraser panel
    if (id === 'image-eraser' && activeTool === 'image-restorer' && restorerParent === 'image-eraser') {
      // close the whole eraser tool
      setActiveTool(null)
      setRestorerParent(null)
      return
    }

    // Toggle off when clicking the currently active tool
    if (activeTool === id) {
      // If turning off a selection tool, clear selection state
      if (id === 'lasso' || id === 'box') {
        clearActiveSelection()
        useStore.getState().clearActiveSelections()
        resetLasso()
      }
      // If turning off crop tool, reset crop settings
      if (id === 'crop') {
        setCropPresetRatio(null)
        setAspectLock(false)
        setCropRect(null)
      }
      setActiveTool(null)
      // if toggling off remove-bg, hide the quick restorer button
      if (id === 'remove-bg') setRestorerParent(null)
      // ensure crop rect cleared immediately when toggling off
      if (id === 'crop') setCropRect(null)
      return
    }

    // Clear selection UI when switching away from box/lasso to another tool
    if (activeTool === 'lasso' || activeTool === 'box') {
      clearActiveSelection()
      useStore.getState().clearActiveSelections()
      resetLasso()
    }

    // Reset crop settings when switching away from crop tool
    if (activeTool === 'crop') {
      setCropPresetRatio(null)
      setAspectLock(false)
      setCropRect(null)
    }

    // When selecting another tool, clear any restorer parent (subtool) state
    setRestorerParent(null)
    setActiveTool(id)
    if (id === 'crop' && currentImage && !cropRect) {
      // Initialize crop rect to full image
      const img = new Image()
      // Prefer base layer image when available so crop rect matches the unfiltered base
      const baseLayerImg = useStore.getState().layers?.find(l => l.type === 'base' && l.config && l.config.image)?.config?.image
      img.src = baseLayerImg || baseImage || currentImage
      img.onload = () => {
        const w = img.width
        const h = img.height
        setCropRect({ x: 0, y: 0, w, h })
      }
    }
  }

  // Portal positioning for presets dropdown on small screens
  const presetBtnRef = useRef(null)
  const [presetPortalStyle, setPresetPortalStyle] = useState({})

  useEffect(() => {
    function updatePos() {
      if (!showPresetDropdown || !presetBtnRef.current) return
      const rect = presetBtnRef.current.getBoundingClientRect()
      const isMobile = window.innerWidth <= 767
      if (isMobile) {
        // position fixed relative to viewport so portal escapes parent clipping
        setPresetPortalStyle({ position: 'fixed', top: `${rect.top}px`, left: `${rect.right}px` })
      } else {
        setPresetPortalStyle({})
      }
    }
    updatePos()
    window.addEventListener('resize', updatePos)
    return () => window.removeEventListener('resize', updatePos)
  }, [showPresetDropdown])

  const handleRemoveBackground = async () => {
    if (!user) { setAuthMessage('Sign in to remove background'); setActivePage('login'); return }
    if (user && user.emailVerified === false) { alert('Please verify your email before using Auto-remove Background'); return }

    // delegate to BackgroundTool and show a small restorer quick button under the Remove Background icon
    await autoRemoveBackground()
    // Keep Remove Background selected and show the quick restorer button
    setActiveTool('remove-bg')
    // leave restorerParent null until user clicks the small restorer icon
  }

  return (
    <div className="tools-panel">
      {/* Mask Section */}
      <div className="tools-section">
        <div className="tools-section-title">Mask</div>
        <div className="tools-list">
          {tools.slice(0, 2).map(tool => {
            const Icon = tool.icon
            // Determine active state; keep parent tool visually active when restorer subtool is in use
            const isActive = activeTool === tool.id || (tool.id === 'remove-bg' && activeTool === 'image-restorer' && restorerParent === 'remove-bg') || (tool.id === 'image-eraser' && activeTool === 'image-restorer' && restorerParent === 'image-eraser')
            return (
              <div key={tool.id}>
                <button
                  className={`tool-btn ${isActive ? 'active' : ''}`}
                  onClick={() => handleSelectTool(tool.id)}
                  title={tool.name}
                  data-tooltip={tool.name}
                >
                  <Icon size={22} />
                </button>
                {/* Embed small restorer sub-icon when Remove Background is selected; clicking it activates restorer as a subtool */}
                {tool.id === 'remove-bg' && (activeTool === 'remove-bg' || restorerParent === 'remove-bg') && (
                  <div className="subicons-wrapper" style={{ display: 'flex', justifyContent: 'center', paddingTop: 6 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <button
                        className={`tool-btn ${(activeTool === 'image-restorer' && restorerParent === 'remove-bg') ? 'active' : ''} subicon-btn`}
                        title="Restorer"
                        onClick={() => {
                          // Toggle restorer subtool under remove-bg: clicking the small icon shows/hides size bars
                          if (activeTool === 'image-restorer' && restorerParent === 'remove-bg') {
                            setActiveTool('remove-bg')
                          } else {
                            setRestorerParent('remove-bg')
                            setActiveTool('image-restorer')
                          }
                        }}
                      ><Restore size={16} /></button>
                      {/* When restorer is active for remove-bg: show sliders then Save below (mirrors image-eraser UI) */}
                      {restorerParent === 'remove-bg' && activeTool === 'image-restorer' && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 6 }}>
                          <div className="subicon-panel" style={{ width: 120 }}>
                            <div style={{ width: '100%', boxSizing: 'border-box', marginBottom: 6 }}>
                              <label style={{ fontSize: 11, color: 'var(--muted)' }}>Size</label>
                              <input style={{ width: '100%' }} type="range" min={4} max={120} value={bgRestorerSize} onChange={(e)=>setBgRestorerSize(parseInt(e.target.value,10))} title="Restorer Size" />
                            </div>
                            <div style={{ width: '100%', boxSizing: 'border-box' }}>
                              <label style={{ fontSize: 11, color: 'var(--muted)' }}>Feather</label>
                              <input style={{ width: '100%' }} type="range" min={0} max={20} value={bgRestorerFeather} onChange={(e)=>setBgRestorerFeather(parseInt(e.target.value,10))} title="Restorer Feather" />
                            </div>
                          </div>
                        </div>
                      )}
                      {/* Show Save button alongside the small Restorer icon when a staged removal exists. */}
                      {hasStagedRemoval && (
                        <button
                          className={`tool-btn subicon-btn`}
                          title="Save Removal"
                          onClick={() => { saveStagedRemoval(); setRestorerParent(null); setActiveTool('remove-bg') }}
                          style={{ marginTop: 8 }}
                        ><Save size={14} /></button>
                      )}
                    </div>
                  </div>
                )}
                {tool.id === 'image-eraser' && (
                  <>
                    {(activeTool === 'image-eraser' || (activeTool === 'image-restorer' && restorerParent === 'image-eraser')) && (
                      <div className="tool-subpanel">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '6px' }}>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center' }}>
                            <div className="subicons-wrapper subicons-vertical">
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <button className={`tool-btn ${activeTool === 'image-eraser' ? 'active' : ''} subicon-btn`} title="Eraser" onClick={() => { setActiveTool('image-eraser'); setRestorerParent(null) }}><Eraser size={16} /></button>
                                {activeTool === 'image-eraser' && (
                                  <div className="subicon-panel" style={{ marginTop: 6, width: 84 }}>
                                    <div style={{ width: '100%', boxSizing: 'border-box' }}>
                                      <input style={{ width: '100%' }} type="range" min={4} max={120} value={bgEraserSize} onChange={(e)=>setBgEraserSize(parseInt(e.target.value,10))} title="Image Eraser Size" />
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 8 }}>
                                <button className={`tool-btn ${activeTool === 'image-restorer' && restorerParent === 'image-eraser' ? 'active' : ''} subicon-btn`} title="Restorer" onClick={() => { setRestorerParent('image-eraser'); setActiveTool('image-restorer') }}><Restore size={16} /></button>
                                {activeTool === 'image-restorer' && restorerParent === 'image-eraser' && (
                                  <div className="subicon-panel" style={{ marginTop: 6, width: 84 }}>
                                    <div style={{ width: '100%', boxSizing: 'border-box', marginBottom: 6 }}>
                                      <label style={{ fontSize: 11, color: 'var(--muted)' }}>Size</label>
                                      <input style={{ width: '100%' }} type="range" min={4} max={120} value={bgRestorerSize} onChange={(e)=>setBgRestorerSize(parseInt(e.target.value,10))} title="Restorer Size" />
                                    </div>
                                    <div style={{ width: '100%', boxSizing: 'border-box' }}>
                                      <label style={{ fontSize: 11, color: 'var(--muted)' }}>Feather</label>
                                      <input style={{ width: '100%' }} type="range" min={0} max={20} value={bgRestorerFeather} onChange={(e)=>setBgRestorerFeather(parseInt(e.target.value,10))} title="Restorer Feather" />
                                    </div>
                                  </div>
                                )}
                                {hasStagedRemoval && (
                                  <button className="tool-btn subicon-btn" title="Save Removal" onClick={() => { saveStagedRemoval(); setRestorerParent(null); setActiveTool('image-eraser') }} style={{ marginTop: 8 }}><Save size={14} /></button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Selection Section */}
      <div className="tools-section">
        <div className="tools-section-title">Select</div>
        <div className="tools-list">
          {tools.slice(2, 5).map(tool => {
            const Icon = tool.icon
            return (
              <div key={tool.id}>
                <button
                  className={`tool-btn ${(activeTool === tool.id || (activeTool === 'image-restorer' && restorerParent === tool.id)) ? 'active' : ''}`}
                  onClick={() => handleSelectTool(tool.id)}
                  title={tool.name}
                  data-tooltip={tool.name}
                >
                  <Icon size={22} />
                </button>
            {(((activeSelection || (activeSelections && activeSelections.length > 0)) || hasStagedRemoval) && (activeTool === tool.id || (activeTool === 'image-restorer' && restorerParent === tool.id)) ) && (
                  <div className="tool-subpanel">
                    <button className="tool-btn" title="Remove" onClick={()=>removeSelection(false)}><Trash2 size={16} /></button>
                    <button className="tool-btn" title="Inverse and Remove" onClick={()=>removeSelection(true)}><Repeat size={16} /></button>
                    {/* Save staged removal so it becomes permanent */}
                    <button className="tool-btn" title="Save Removal" onClick={() => { saveStagedRemoval(); setRestorerParent(null); setActiveTool(tool.id); }}><Save size={16} /></button>
                    {/* Restore subtool: activate image restorer with parent indicating selection tool */}
                    <button className={`tool-btn ${activeTool === 'image-restorer' && restorerParent === tool.id ? 'active' : ''}`} title="Restore" onClick={() => { setRestorerParent(tool.id); setActiveTool('image-restorer') }}><Restore size={16} /></button>
                    {/* When restorer is active for this selection parent, show size/feather sliders */}
                    {activeTool === 'image-restorer' && restorerParent === tool.id && (
                      <div className="subicon-panel" style={{ marginTop: 6, width: 140 }}>
                        <div style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8 }}>
                          <label style={{ fontSize: 11, color: 'var(--muted)' }}>Size</label>
                          <input style={{ width: '100%' }} type="range" min={4} max={120} value={bgRestorerSize} onChange={(e)=>setBgRestorerSize(parseInt(e.target.value,10))} title="Restorer Size" />
                        </div>
                        <div style={{ width: '100%', boxSizing: 'border-box' }}>
                          <label style={{ fontSize: 11, color: 'var(--muted)' }}>Feather</label>
                          <input style={{ width: '100%' }} type="range" min={0} max={20} value={bgRestorerFeather} onChange={(e)=>setBgRestorerFeather(parseInt(e.target.value,10))} title="Restorer Feather" />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Crop Section */}
      <div className="tools-section">
        <div className="tools-section-title">Crop</div>
        <div className="tools-list">
          {tools.slice(5, 6).map(tool => {
            const Icon = tool.icon
            return (
              <div key={tool.id}>
                <button
                  className={`tool-btn ${activeTool === tool.id ? 'active' : ''}`}
                  onClick={() => handleSelectTool(tool.id)}
                  title={tool.name}
                  data-tooltip={tool.name}
                >
                  <Icon size={22} />
                </button>
                {activeTool === 'crop' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 6px' }}>
                        <button
                      className={`tool-btn ${aspectLock && !cropPresetRatio ? 'active' : ''}`}
                      onClick={() => {
                        setAspectLock(!aspectLock)
                        if (!aspectLock) setCropPresetRatio(null)
                      }}
                      title="Lock Aspect Ratio"
                      data-tooltip="Lock Aspect"
                    >
                      <Maximize2 size={20} />
                    </button>
                    <div style={{ position: 'relative' }}>
                      <button
                        ref={presetBtnRef}
                        className="tool-btn no-tooltip"
                        onClick={() => setShowPresetDropdown(!showPresetDropdown)}
                        title="Aspect Ratio Presets"
                        data-tooltip="Presets"
                      >
                        {cropPresetRatio ? `${presetRatios.find(p => p.ratio === cropPresetRatio)?.label || 'Custom'}` : 'Presets'}
                      </button>
                      {showPresetDropdown && (() => {
                        const dropdown = (
                          <div className="preset-dropdown" style={{
                            position: presetPortalStyle.position ? presetPortalStyle.position : 'absolute',
                            top: presetPortalStyle.top ? presetPortalStyle.top : 0,
                            left: presetPortalStyle.left ? presetPortalStyle.left : '100%',
                            backgroundColor: 'var(--panel-2)',
                            border: '1px solid var(--muted-2)',
                            borderRadius: '4px',
                            minWidth: '80px',
                            zIndex: 3000,
                            boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
                          }}>
                            {presetRatios.map((p) => (
                              <div
                                key={p.label}
                                onClick={() => {
                                  setCropPresetRatio(p.ratio)
                                  setAspectLock(p.ratio !== null)
                                  setShowPresetDropdown(false)
                                }}
                                style={{
                                  padding: '8px 12px',
                                  cursor: 'pointer',
                                  backgroundColor: cropPresetRatio === p.ratio ? 'var(--muted-2)' : 'transparent',
                                  color: 'var(--text)',
                                  fontSize: '12px',
                                  borderBottom: '1px solid var(--border)',
                                }}
                                onMouseEnter={(e) => e.target.style.backgroundColor = 'var(--hover)'}
                                onMouseLeave={(e) => e.target.style.backgroundColor = cropPresetRatio === p.ratio ? 'var(--muted-2)' : 'transparent'}
                              >
                                {p.label}
                              </div>
                            ))}
                          </div>
                        )
                        // If presetPortalStyle is set to a fixed position, render into body to escape clipping
                        if (presetPortalStyle.position === 'fixed') {
                          return ReactDOM.createPortal(dropdown, document.body)
                        }
                        return dropdown
                      })()}
                    </div>
                      {cropRect && (
                      <>
                        <button
                          className="tool-btn"
                          title="Apply Crop"
                          onClick={() => {
                            // When applying crop, crop the base (unfiltered) image if available
                            const img = new Image()
                            const baseLayerImg = useStore.getState().layers?.find(l => l.type === 'base' && l.config && l.config.image)?.config?.image
                            img.src = baseLayerImg || baseImage || currentImage
                            img.onload = () => {
                              const off = document.createElement('canvas')
                              off.width = cropRect.w
                              off.height = cropRect.h
                              off.getContext('2d').drawImage(img, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, cropRect.w, cropRect.h)
                              applyCrop(off.toDataURL('image/png'))
                            }
                          }}
                          data-tooltip="Apply"
                        >
                          <Check size={20} />
                        </button>
                        <button
                          className="tool-btn"
                          title="Reset Crop"
                          onClick={() => {
                            if (!currentImage) return
                            const img = new Image()
                            img.src = currentImage
                            img.onload = () => {
                              const w = img.width
                              const h = img.height
                              setCropRect({ x: 0, y: 0, w, h })
                            }
                          }}
                          data-tooltip="Reset"
                        >
                          <span style={{fontSize:16}}>↺</span>
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Pen Section */}
      <div className="tools-section">
        <div className="tools-section-title">Draw</div>
        <div className="tools-list">
          {tools.slice(6, 7).map(tool => {
            const Icon = tool.icon
            return (
              <div key={tool.id}>
                <button
                  className={`tool-btn ${activeTool === tool.id ? 'active' : ''}`}
                  onClick={() => handleSelectTool(tool.id)}
                  title={tool.name}
                  data-tooltip={tool.name}
                >
                  <Icon size={22} />
                </button>
                {activeTool === 'pen' && (
                  <div className="tool-subpanel">
                    <input type="color" value={penColor} onChange={(e)=>setPenColor(e.target.value)} title="Pen Color" />
                    <input type="range" min={1} max={40} value={penSize} onChange={(e)=>setPenSize(parseInt(e.target.value,10))} title="Pen Size" />
                    <button className={`tool-btn ${penMode==='draw'?'active':''}`} title="Draw" onClick={()=>setPenMode('draw')}><Pen size={18} /></button>
                    <button className={`tool-btn ${penMode==='erase'?'active':''}`} title="Erase Drawings" onClick={()=>setPenMode('erase')}><Eraser size={18} /></button>
                    <button className="tool-btn" title="Save Drawings" onClick={()=>useStore.getState().savePenStrokes()}><Save size={16} /></button>
                    {/* Cancel button removed — clicking the Pen tool again or any other tool now clears unsaved strokes */}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default ToolsPanel
