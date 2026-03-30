import { useEffect, useState } from 'react'
import { auth } from '../firebaseConfig'
import { useStore } from '../store/useStore'
import { saveProjectForUser } from '../services/saveProject'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  sendEmailVerification,
} from 'firebase/auth'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
      // if a save was pending, perform it now
      try {
        const pending = useStore.getState().pendingSaveAfterAuth
        if (u && pending) {
          const state = useStore.getState()
          const img = state.currentImage
          const title = state.currentTitle
          if (img) {
            try { useStore.getState().showToast('Saving project...') } catch (e) {}
            saveProjectForUser(u, img, title).then(() => {
              useStore.getState().setPendingSaveAfterAuth(false)
              useStore.getState().setActivePage('editor')
              try { useStore.getState().showToast('Project saved') } catch (e) {}
              setTimeout(() => { try { useStore.getState().hideToast() } catch (e) {} }, 1600)
              // optionally refresh projects list if needed
            }).catch((e) => {
              console.error('Auto-save after auth failed', e)
              try { useStore.getState().showToast('Save failed') } catch (err) {}
              setTimeout(() => { try { useStore.getState().hideToast() } catch (er) {} }, 3000)
              useStore.getState().setPendingSaveAfterAuth(false)
            })
          } else {
            useStore.getState().setPendingSaveAfterAuth(false)
          }
        }
      } catch (e) {
        console.warn('post-auth save handler failed', e)
      }
    })
    return unsub
  }, [])

  const signUp = async (email, password) => {
    // Pre-check email domain to avoid creating accounts for clearly bogus domains.
    // Normalize configured upload URL if present to derive API root.
    try {
      const q = new URLSearchParams({ email })
      const configured = import.meta.env.VITE_API_URL || ''
      // If VITE_API_UPLOAD_URL points at /api/upload, convert it to /api
      const apiRoot = configured
        ? configured.replace(/\/api\/?$/i, '/api').replace(/\/$/, '')
        : '/api'
      const url = `${apiRoot}/check-email-domain?` + q.toString()
      const resp = await fetch(url)
      if (resp && resp.ok) {
        const j = await resp.json()
        if (!j.ok) {
          // throw an error that will be mapped to a friendly message
          const err = new Error('Email domain does not appear to accept mail')
          err.code = 'auth/no_mx_record'
          throw err
        }
      } else {
        // If the endpoint isn't available (404) or returns an error, log a warning
        // and continue with signup (best-effort validation). This prevents
        // blocking signup due to misconfiguration or temporary server issues.
        if (resp && resp.status === 404) {
          console.warn('Email domain check endpoint not found at', url)
        } else if (resp && !resp.ok) {
          console.warn('Email domain check returned non-ok status', resp.status)
        }
      }
    } catch (e) {
      if (e && e.code === 'auth/no_mx_record') throw e
      console.warn('Email domain check failed, continuing with signup', e)
    }

    const res = await createUserWithEmailAndPassword(auth, email, password)
    // send verification with environment-aware continue URL so dev vs prod can differ
    try {
      const continueUrl = import.meta.env.VITE_FIREBASE_CONTINUE_URL || import.meta.env.VITE_CONTINUE_URL || (typeof window !== 'undefined' ? window.location.origin : undefined)
      const actionCodeSettings = {
        url: continueUrl,
        handleCodeInApp: true,
      }
      await sendEmailVerification(res.user, actionCodeSettings)
    } catch (e) {}
    return res
  }

  const signIn = (email, password) => signInWithEmailAndPassword(auth, email, password)

  const signOut = async () => fbSignOut(auth)

  // Enhanced signOut: confirm when there are unsaved edits, show toast, and reset editor state.
  const enhancedSignOut = async () => {
    try {
      const s = useStore.getState()
      // Determine if there are unsaved edits: compare first and last history images
      let hasEdits = false
      try {
        if (Array.isArray(s.history) && s.history.length > 1) {
          const first = s.history[0] && s.history[0].image
          const last = s.history[s.history.length - 1] && s.history[s.history.length - 1].image
          if (first && last && first !== last) hasEdits = true
        }
      } catch (e) {}

      if (hasEdits) {
        const ok = window.confirm('You have unsaved edits. Signing out will discard these changes. Do you want to continue and sign out?')
        if (!ok) return
      }

      try { useStore.getState().showToast('Signing out...') } catch (e) {}
      await fbSignOut(auth)
      // Reset editor state and any pending flags
      try { useStore.getState().createEmptyProject() } catch (e) {}
      try { useStore.getState().setPendingSaveAfterAuth(false) } catch (e) {}
      try { useStore.getState().setAuthMessage(null) } catch (e) {}
      try { useStore.getState().showToast('Signed out') } catch (e) {}
      setTimeout(() => { try { useStore.getState().hideToast() } catch (e) {} }, 1400)
    } catch (e) {
      try { useStore.getState().showToast('Sign out failed') } catch (err) {}
      setTimeout(() => { try { useStore.getState().hideToast() } catch (er) {} }, 1800)
      throw e
    }
  }

  const sendVerification = async () => {
    if (!auth.currentUser) throw new Error('No current user')
    const continueUrl = import.meta.env.VITE_FIREBASE_CONTINUE_URL || import.meta.env.VITE_CONTINUE_URL || (typeof window !== 'undefined' ? window.location.origin : undefined)
    const actionCodeSettings = {
      url: continueUrl,
      handleCodeInApp: true,
    }
    return sendEmailVerification(auth.currentUser, actionCodeSettings)
  }

  return { user, loading, signUp, signIn, signOut: enhancedSignOut, sendVerification }
}

export default useAuth
