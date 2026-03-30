import React, { useEffect, useState } from 'react'
import { auth } from '../firebaseConfig'
import { applyActionCode } from 'firebase/auth'
import { useStore } from '../store/useStore'

export default function VerifyEmail({ oobCode, mode }) {
  const [status, setStatus] = useState('working')
  const setActivePage = useStore(state => state.setActivePage)

  useEffect(() => {
    const doApply = async () => {
      if (!oobCode) {
        setStatus('missing')
        return
      }
      try {
        await applyActionCode(auth, oobCode)
        setStatus('success')
        // after a short delay, navigate to login/editor
        setTimeout(() => setActivePage('login'), 1600)
      } catch (e) {
        console.error('Verification failed', e)
        setStatus('error')
      }
    }
    doApply()
  }, [oobCode, setActivePage])

  return (
    <div style={{ padding: 24 }}>
      {status === 'working' && <div>Verifying your email...</div>}
      {status === 'success' && <div>Your email was verified — redirecting to sign in.</div>}
      {status === 'error' && <div>Verification failed. The link may be invalid or expired.</div>}
      {status === 'missing' && <div>No verification code provided.</div>}
    </div>
  )
}
