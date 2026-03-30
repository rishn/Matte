import React, { useEffect, useState } from 'react'
import { Edit3, Trash2, Check, X } from 'lucide-react'
import { useStore } from '../store/useStore'
import useAuth from '../hooks/useAuth'
import { collection, getDocs, query, orderBy, updateDoc, doc, deleteDoc, getDoc } from 'firebase/firestore'
import { db } from '../firebaseConfig'

export default function Projects(){
  const { user } = useAuth()
  const setActivePage = useStore(state => state.setActivePage)
  const createEmptyProject = useStore(state => state.createEmptyProject)
  const initImage = useStore(state => state.initImage)
  const setCurrentTitle = useStore(state => state.setCurrentTitle)

  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(()=>{
    if (!user) return
    fetchProjects()
    // eslint-disable-next-line
  }, [user])

  const fetchProjects = async () => {
    if (!user) return
    setLoading(true)
    try{
      const q = query(collection(db, 'users', user.uid, 'projects'), orderBy('createdAt','desc'))
      const snap = await getDocs(q)
      const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setProjects(arr)
    }catch(e){ console.error(e) }
    setLoading(false)
  }

  const renameProject = async (projectId, newTitle) => {
    if (!user) return
    try {
      const d = doc(db, 'users', user.uid, 'projects', projectId)
      await updateDoc(d, { title: newTitle })
      await fetchProjects()
      try { useStore.getState().showToast('Project renamed') } catch (e) {}
      setTimeout(() => { try { useStore.getState().hideToast() } catch (e) {} }, 1600)
    } catch (e) { console.error('rename failed', e) }
  }

  const deleteProject = async (projectId) => {
    if (!user) return
    try {
      // Fetch doc to see if there's a storagePath to remove from Supabase
      const d = doc(db, 'users', user.uid, 'projects', projectId)
      // get current doc data
      const snapshot = await getDoc(d)
      const data = snapshot.exists() ? snapshot.data() : null
      if (data && data.storagePath) {
        try {
          const token = await user.getIdToken()
          const url = `${import.meta.env.VITE_API_URL || '/api'}`.replace(/\/api\/?$/, '/api/delete')
          const qs = `?path=${encodeURIComponent(data.storagePath)}`
          const res = await fetch(url + qs, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
          if (!res.ok) {
            console.warn('Failed to delete storage object:', await res.text())
          }
        } catch (e) {
          console.warn('Error deleting storage object', e)
        }
      }
      await deleteDoc(d)
      await fetchProjects()
      try { useStore.getState().showToast('Project deleted') } catch (e) {}
      setTimeout(() => { try { useStore.getState().hideToast() } catch (e) {} }, 1600)
    } catch (e) { console.error('delete failed', e) }
  }

  const openProject = async (p) => {
    if (!p) return
    try {
      // If there are unsaved edits in the current editor, warn the user
      try {
        const s = useStore.getState()
        if (s && s.currentImage && Array.isArray(s.history) && s.history.length > 1) {
          const first = s.history[0] && s.history[0].image
          const last = s.history[s.history.length - 1] && s.history[s.history.length - 1].image
          if (first && last && first !== last) {
            const ok = window.confirm('You have unsaved edits in the editor. Opening another project will discard these edits. Continue and discard edits?')
            if (!ok) return
            // User confirmed: clear undo/redo queues to start fresh
            try { useStore.setState({ history: [], future: [], stagedRemoval: null, hasStagedRemoval: false, drawingStrokes: [] }) } catch (e) {}
          }
        }
      } catch (e) {}

      setCurrentTitle(p.title || 'Untitled')
      setActivePage('editor')
      // Prefer Supabase-stored full image if available
      if (p.storageUrl) {
        initImage(p.storageUrl)
        return
      }
      if (p.storagePath && user) {
        try {
          const token = await user.getIdToken()
          const base = import.meta.env.VITE_API_UPLOAD_URL || '/api/upload'
          const url = base.replace(/\/api\/upload\/?$/, '/api/signed-url')
          const qs = `?path=${encodeURIComponent(p.storagePath)}`
          const res = await fetch(url + qs, { headers: { Authorization: `Bearer ${token}` } })
          if (res.ok) {
            const j = await res.json()
            if (j.signedUrl) {
              initImage(j.signedUrl)
              // optionally update the project doc with storageUrl for quicker opens next time
              try { const d = doc(db, 'users', user.uid, 'projects', p.id); await updateDoc(d, { storageUrl: j.signedUrl }) } catch(e){}
              return
            }
          }
        } catch (e) { console.warn('Failed to fetch signed URL', e) }
      }

      // Next, try to restore from saved projectState or baseImage
      if (p.projectState) {
        const stateObj = typeof p.projectState === 'string' ? JSON.parse(p.projectState) : p.projectState
        if (stateObj && stateObj.baseImage) {
          initImage(stateObj.baseImage)
          return
        }
      }
      if (p.baseImage) {
        initImage(p.baseImage)
        return
      }
      if (p.fullImage) {
        initImage(p.fullImage)
        return
      }
      if (p.thumbnailBase64) {
        initImage(p.thumbnailBase64)
        // thumbnail only - inform user
        setTimeout(()=>alert('Opened project using thumbnail; full project data was not saved.'), 50)
        return
      }
      alert('Project has no image data to open')
    } catch (e) {
      console.error('open project failed', e)
      alert('Failed to open project')
    }
  }

  return (
    <div className="page-inner" style={{ padding: 20 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <h2>Your Projects</h2>
      </div>
      {user ? (
        <div>
          {loading && <div>Loading...</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px,1fr))', gap: 12, marginTop: 16 }}>
            {/* New project tile */}
            <div
              onClick={() => { createEmptyProject(); setActivePage('editor') }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '2px dashed var(--muted)', padding: 12, borderRadius: 6, height: 200, cursor: 'pointer', background: 'transparent' }}
              title="Create new project"
            >
              <div style={{ fontSize: 36, color: 'var(--muted)' }}>+</div>
              <div style={{ marginTop: 8, color: 'var(--muted)' }}>New Project</div>
            </div>

            {projects.map(p=> (
              <ProjectCard
                key={p.id}
                project={p}
                onOpen={() => openProject(p)}
                onRename={(newTitle) => renameProject(p.id, newTitle)}
                onDelete={() => deleteProject(p.id)}
              />
            ))}
          </div>
        </div>
      ) : (
        <div>Please sign in to view and save projects.</div>
      )}
    </div>
  )
}

// helper: create a downsized thumbnail from a dataURL
const createThumbnail = (dataUrl, maxDim = 256, quality = 0.7) => {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1)
      const w = Math.round(img.width * ratio)
      const h = Math.round(img.height * ratio)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      // convert to jpeg to reduce size
      const thumb = canvas.toDataURL('image/jpeg', quality)
      resolve(thumb)
    }
    img.onerror = (e) => reject(e)
    img.src = dataUrl
  })
}

function ProjectCard({ project, onOpen, onRename, onDelete }){
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(project.title || '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [hover, setHover] = useState(false)
  useEffect(()=>{ setTitle(project.title || '') }, [project.title])

  return (
    <div
      onClick={(e)=>{ e.stopPropagation(); if (!editing && !confirmDelete && typeof onOpen === 'function') onOpen() }}
      role="button"
      tabIndex={0}
      onKeyDown={(e)=>{ if (e.key === 'Enter') { if (!editing && !confirmDelete && typeof onOpen === 'function') onOpen() } }}
      style={{
        background: 'var(--panel)',
        padding: 8,
        borderRadius: 6,
        position: 'relative',
        cursor: 'pointer',
        transition: 'transform .12s ease, box-shadow .12s ease',
        transform: hover ? 'translateY(-4px)' : 'none',
        boxShadow: hover ? '0 6px 18px rgba(0,0,0,0.24)' : 'none'
      }}
      onMouseEnter={()=>setHover(true)}
      onMouseLeave={()=>setHover(false)}
    >
      <img src={project.thumbnailBase64 || project.thumbnail} alt={project.title} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 4 }} />

          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {editing ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
            <input className="header-title-input project-rename-input" value={title} onChange={(e)=>setTitle(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
            <button className="icon-btn" onClick={(e)=>{ e.stopPropagation(); setEditing(false); onRename && onRename(title) }} title="Save title"><Check size={16} /></button>
            <button className="icon-btn" onClick={(e)=>{ e.stopPropagation(); setEditing(false); setTitle(project.title || '') }} title="Cancel"><X size={16} /></button>
          </div>
        ) : (
          <>
            <div className="project-title" style={{ flex: 1 }} title={project.title}>{project.title}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="icon-btn" onClick={(e)=>{ e.stopPropagation(); setEditing(true) }} title="Rename"><Edit3 size={16} /></button>
              <button className="icon-btn" onClick={(e)=>{ e.stopPropagation(); setConfirmDelete(true) }} title="Delete"><Trash2 size={16} /></button>
            </div>
          </>
        )}
      </div>

      {confirmDelete && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6 }}>
          <div style={{ background: 'var(--panel)', padding: 16, borderRadius: 8, width: 300 }}>
            <div style={{ fontWeight: 600 }}>Delete project?</div>
            <div style={{ marginTop: 8 }}>This will permanently delete "{project.title}". Are you sure?</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="header-btn" onClick={(e)=>{ e.stopPropagation(); setConfirmDelete(false) }}><span>Cancel</span></button>
              <button className="header-btn" onClick={(e)=>{ e.stopPropagation(); setConfirmDelete(false); onDelete && onDelete() }} style={{ background: 'var(--danger)', color: 'white' }}><span>Delete</span></button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
