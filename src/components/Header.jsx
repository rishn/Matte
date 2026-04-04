import React from 'react'
import { Upload, Download, Save, Undo, Redo, RotateCcw, LogIn, LogOut, Grid, Edit3, User, MoreVertical } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import useAuth from '../hooks/useAuth'
import { saveProjectForUser } from '../services/saveProject'
import './Header.css'

function Header() {
  const navigate = useNavigate()
  const { currentImage, setImage, setMask, setIsProcessing, initImage, undo, redo, history, future, showToast, hideToast, setActivePage, activePage, currentTitle, setCurrentTitle, setPendingSaveAfterAuth, setAuthMessage } = useStore()
  const { user, signOut } = useAuth()
  const fileInputRef = React.useRef(null)
  const [kebabOpen, setKebabOpen] = React.useState(false)
  const kebabRef = React.useRef(null)

  React.useEffect(() => {
    function onDoc(e) {
      if (kebabRef.current && !kebabRef.current.contains(e.target)) setKebabOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setKebabOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  // no menu: keep navigation buttons persistent

  const handleOpenFile = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e) => {
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

  const handleExport = async () => {
    if (!currentImage) return
    if (!user) {
      // redirect to sign-in when trying to export without auth
      try { setAuthMessage('Please sign in to export images'); setActivePage('login') } catch (e) { window.history.pushState(null, '', '/login'); }
      return
    }
    if (user && user.emailVerified === false) { alert('Please verify your email before exporting images'); return }

    // If currentImage is a remote URL (e.g. Supabase signed URL), fetch it as a blob
    try {
      let blob = null
      if (typeof currentImage === 'string' && (currentImage.startsWith('http://') || currentImage.startsWith('https://'))) {
        const res = await fetch(currentImage)
        if (!res.ok) throw new Error('Failed to fetch image for export')
        blob = await res.blob()
      } else if (typeof currentImage === 'string' && currentImage.startsWith('data:')) {
        // data URL -> convert to blob
        const parts = currentImage.split(',')
        const meta = parts[0]
        const b64 = parts[1]
        const mime = meta.split(':')[1].split(';')[0]
        const byteChars = atob(b64)
        const byteNumbers = new Array(byteChars.length)
        for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i)
        const byteArray = new Uint8Array(byteNumbers)
        blob = new Blob([byteArray], { type: mime })
      } else {
        // Fallback: try to download via link (may work for same-origin data)
        const link = document.createElement('a')
        link.href = currentImage
        link.download = `matte-${Date.now()}.png`
        link.click()
        return
      }

      // Create an object URL and trigger download
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `matte-${Date.now()}.png`
      document.body.appendChild(link)
      link.click()
      link.remove()
      // release memory after a short delay
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      console.error('Export failed', e)
      try { showToast('Export failed; please try again') } catch (er) {}
      alert('Export failed: ' + (e?.message || JSON.stringify(e)))
    }
  }


  return (
    <header className="header">
      <div className="header-left">
        <div className="logo" role="button" onClick={() => navigate(-1)} style={{ cursor: 'pointer' }} title="Back">
          <img src="/Matte.png" width={"30px"} alt="Matte" className="logo-icon" />
          <span className="logo-text">Matte</span>
        </div>
      </div>

      <div className="header-center">
        {activePage === 'editor' && (
          <>
            <input
              className="header-title-input"
              value={currentTitle || ''}
              onChange={(e) => setCurrentTitle(e.target.value)}
              placeholder="Untitled"
              disabled={!currentImage}
              title={currentImage ? 'Edit project title' : 'Open an image to name your project'}
            />

            <button className="header-btn" onClick={handleOpenFile} title="Open Image">
              <Upload size={18} />
              <span>Open</span>
            </button>

            <button className="header-btn" onClick={async () => {
              if (!currentImage) { alert('No image to save'); return }
              if (!user) {
                setPendingSaveAfterAuth(true)
                try { setAuthMessage('Sign in to save your project') } catch (e) {}
                setActivePage('login')
                return
              }
              if (user && user.emailVerified === false) { alert('Please verify your email before saving projects'); return }
              try {
                // collect project state to persist editor metadata
                const state = useStore.getState()
                const projectState = {
                  baseImage: state.baseImage,
                  layers: state.layers,
                  adjustments: state.adjustments,
                  drawingStrokes: state.drawingStrokes,
                  manualRemovalMasks: state.manualRemovalMasks || [],
                  // keep a small slice of history for quick undo on reload
                  history: (state.history || []).slice(-3)
                }

                // show a saving toast while upload occurs
                try { showToast('Saving project...') } catch (e) {}
                await saveProjectForUser(user, currentImage, currentTitle, projectState)
                try { showToast('Project saved') } catch (e) {}
                // hide toast after a brief delay so user sees confirmation
                setTimeout(() => { try { hideToast() } catch (e) {} }, 1800)
                try { setPendingSaveAfterAuth(false) } catch (e) {}
              } catch (e) {
                console.error('Save failed', e)
                try { showToast('Save failed') } catch (err) {}
                setTimeout(() => { try { hideToast() } catch (er) {} }, 3000)
                alert('Save failed: ' + (e?.message || JSON.stringify(e)))
              }
            }} title="Save to Projects" disabled={!currentImage}>
              <Save size={18} />
              <span>Save</span>
            </button>

            <button 
              className="header-btn" 
              onClick={handleExport} 
              disabled={!currentImage}
              title="Export Image"
            >
              <Download size={18} />
              <span>Export</span>
            </button>
            <div className="divider" />
            <button className="header-btn icon-only" title="Undo" onClick={undo} disabled={history.length <= 1}>
              <Undo size={18} />
            </button>
            <button className="header-btn icon-only" title="Redo" onClick={redo} disabled={future.length === 0}>
              <Redo size={18} />
            </button>
            <button
              className="header-btn icon-only"
              title="Reset to Original"
              onClick={() => {
                const orig = useStore.getState().originalImageBase64 || useStore.getState().originalImage
                if (!orig) return
                showToast('Resetting image...')
                try {
                  initImage(orig)
                } catch (e) {
                  console.error('Reset failed', e)
                } finally {
                  hideToast()
                }
              }}
              disabled={!useStore.getState().originalImage && !useStore.getState().originalImageBase64}
            >
              <RotateCcw size={18} />
            </button>
          </>
        )}
      </div>

      <div className="header-right">
        {user ? (
          <div className="header-right-group">
            <button className={`header-btn editor-btn ${activePage === 'editor' ? 'active' : ''}`} onClick={() => setActivePage('editor')} title="Editor">
              <Edit3 size={18} />
              <span>Editor</span>
            </button>

            <button className={`header-btn ${activePage === 'projects' ? 'active' : ''}`} onClick={() => setActivePage('projects')} title="Projects">
              <Grid size={18} />
              <span>Projects</span>
            </button>

            <button className={`header-btn header-email-btn ${activePage === 'profile' ? 'active' : ''}`} style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => setActivePage('profile')} title={user.email}>
              <User size={16} className="header-email-icon" />
              <span className="header-email-text">{maskEmail(user.email)}</span>
            </button>

            <button className="header-btn icon-only" title="Sign out" onClick={() => signOut()}><LogOut size={16} /></button>
          </div>
        ) : (
          <div className="header-right-group">
            <button className={`header-btn ${activePage === 'editor' ? 'active' : ''}`} onClick={() => setActivePage('editor')} title="Editor">
              <Edit3 size={18} />
              <span>Editor</span>
            </button>
            <button className={`header-btn ${activePage === 'projects' ? 'active' : ''}`} onClick={() => setActivePage('projects')} title="Projects">
              <Grid size={18} />
              <span>Projects</span>
            </button>
            <button className={`header-btn ${activePage === 'login' ? 'active' : ''}`} onClick={() => setActivePage('login')} title="Sign in">
              <span>Sign In</span>
            </button>
          </div>
        )}

        {/* Kebab menu for small screens: replaces the right-side buttons */}
        <div ref={kebabRef} style={{ position: 'relative' }}>
          <button type="button" className="header-btn header-kebab-btn" onMouseDown={(e) => { e.stopPropagation(); console.log('kebab mousedown toggle', kebabOpen); setKebabOpen(s => !s); }} title="Menu" aria-expanded={kebabOpen}>
            <MoreVertical size={18} />
          </button>

          <div className={`kebab-menu ${kebabOpen ? 'open' : ''}`} role="menu" aria-hidden={!kebabOpen}>
            <button type="button" className="kebab-item" onClick={() => { setActivePage('editor'); setKebabOpen(false) }}>Editor</button>
            <button type="button" className="kebab-item" onClick={() => { setActivePage('projects'); setKebabOpen(false) }}>Projects</button>
            <button type="button" className="kebab-item" onClick={() => { setActivePage('profile'); setKebabOpen(false) }}>Profile</button>
            {user ? (
              <button type="button" className="kebab-item" onClick={() => { signOut(); setKebabOpen(false) }}>Sign out</button>
            ) : (
              <button type="button" className="kebab-item" onClick={() => { setActivePage('login'); setKebabOpen(false) }}>Sign in</button>
            )}
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
    </header>
  )
}

export default Header

function maskEmail(email) {
  if (!email) return ''
  // If short, return as-is
  if (email.length <= 24) return email
  // show first 8 and last 8
  const first = email.slice(0, 8)
  const last = email.slice(-8)
  return `${first}...${last}`
}
