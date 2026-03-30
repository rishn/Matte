import React, { useState } from 'react'
import { auth } from '../firebaseConfig'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import { Eye, EyeOff } from 'lucide-react'
import useAuth from '../hooks/useAuth'
import { useStore } from '../store/useStore'

export default function Profile(){
  const { user, signOut } = useAuth()
  const setActivePage = useStore(state => state.setActivePage)
  const [showForm, setShowForm] = useState(false)
  const [oldPass, setOldPass] = useState('')
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [showOldPass, setShowOldPass] = useState(false)
  const [showNewPass, setShowNewPass] = useState(false)
  const [showConfirmPass, setShowConfirmPass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setMessage(null)
    if (!user || !user.email) return setMessage('No authenticated user.')
    if (!oldPass || !newPass || !confirmPass) return setMessage('Please fill all fields')
    if (newPass !== confirmPass) return setMessage('New password and confirmation do not match')
    setBusy(true)
    try {
      const cred = EmailAuthProvider.credential(user.email, oldPass)
      await reauthenticateWithCredential(auth.currentUser, cred)
      await updatePassword(auth.currentUser, newPass)
      setMessage('Password updated successfully')
      setShowForm(false)
      setOldPass(''); setNewPass(''); setConfirmPass('')
      // sign out so user must sign in with new password
      try { useStore.getState().showToast('Password updated') } catch (e) {}
      setTimeout(() => { try { useStore.getState().hideToast() } catch (e) {} }, 1600)
      setTimeout(async () => {
        try { await signOut() } catch {}
        setActivePage('login')
      }, 1000)
    } catch (err) {
      setMessage(err?.message || 'Password update failed')
    } finally { setBusy(false) }
  }

  if (!user) return (
    <div className="page-inner" style={{ padding: 20 }}>
      <h2>Profile</h2>
      <div>Please sign in to view profile.</div>
    </div>
  )

  return (
    <div className="page-inner" style={{ padding: 20 }}>
      <h2 style={{ marginBottom: 14 }}>Profile</h2>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 6 }}>Email</div>
        <div style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 15, maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
      </div>
      <div>
        {!showForm && (
          <button className="header-btn" onClick={() => { setShowForm(s=>!s); setMessage(null) }} style={{ padding: '8px 12px' }}>Change password</button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} style={{ marginTop: 12, maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 13 }}>Old password</label>
          <div className="password-wrapper">
            <input className="header-title-input" type={showOldPass ? 'text' : 'password'} value={oldPass} onChange={e=>setOldPass(e.target.value)} />
            <button type="button" className="password-toggle" aria-label={showOldPass ? 'Hide old password' : 'Show old password'} onClick={()=>setShowOldPass(s=>!s)}>
              {showOldPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <label style={{ fontSize: 13 }}>New password</label>
          <div className="password-wrapper">
            <input className="header-title-input" type={showNewPass ? 'text' : 'password'} value={newPass} onChange={e=>setNewPass(e.target.value)} />
            <button type="button" className="password-toggle" aria-label={showNewPass ? 'Hide new password' : 'Show new password'} onClick={()=>setShowNewPass(s=>!s)}>
              {showNewPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <label style={{ fontSize: 13 }}>Confirm new password</label>
          <div className="password-wrapper">
            <input className="header-title-input" type={showConfirmPass ? 'text' : 'password'} value={confirmPass} onChange={e=>setConfirmPass(e.target.value)} />
            <button type="button" className="password-toggle" aria-label={showConfirmPass ? 'Hide confirm password' : 'Show confirm password'} onClick={()=>setShowConfirmPass(s=>!s)}>
              {showConfirmPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {message && <div style={{ color: message.includes('success') ? 'var(--accent)' : 'salmon' }}>{message}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="header-btn" type="submit" disabled={busy} style={{ padding: '8px 12px' }}>{busy ? 'Working…' : 'Update password'}</button>
            <button className="header-btn" type="button" onClick={() => { setShowForm(false); setMessage(null) }} style={{ padding: '8px 12px' }}>Cancel</button>
          </div>
        </form>
      )}
      
      {/* Sign out button always shown below the change-password area */}
      <div style={{ marginTop: 16 }}>
        <button className="header-btn" onClick={async () => { try { await signOut() } catch (e) {} setActivePage('login') }} style={{ padding: '8px 12px' }}>Sign out</button>
      </div>
    </div>
  )
}
