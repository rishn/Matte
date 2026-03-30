import React, { useEffect } from 'react'
import { useStore } from '../store/useStore'
import './Toast.css'

export default function Toast() {
  const toast = useStore(state => state.toast)
  const hide = useStore(state => state.hideToast)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => {
      try { hide() } catch (e) {}
    }, 2500)
    return () => clearTimeout(t)
  }, [toast, hide])

  if (!toast) return null

  return (
    <div className="global-toast" role="status" aria-live="polite">
      {toast}
    </div>
  )
}
