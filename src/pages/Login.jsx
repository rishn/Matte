import React, { useState } from 'react'
import useAuth from '../hooks/useAuth'
import { Eye, EyeOff } from 'lucide-react'
import { useStore } from '../store/useStore'
import './Login.css'
import friendlyAuthMessage from '../utils/authErrors'

export default function Login() {
  const { signIn, signUp } = useAuth()
  const setActivePage = useStore(state => state.setActivePage)
  const authMessage = useStore(state => state.authMessage)
  const setAuthMessage = useStore(state => state.setAuthMessage)
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e && e.preventDefault()
    setError(null)
    if (!isLogin && password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      if (isLogin) {
        await signIn(email, password)
      } else {
        await signUp(email, password)
      }
      // Clear any auth redirect message after successful sign-in
      try { setAuthMessage(null) } catch (e) {}
      setActivePage('editor')
      try { useStore.getState().showToast(isLogin ? 'Signed in successfully' : 'Account created') } catch (e) {}
      setTimeout(() => { try { useStore.getState().hideToast() } catch (e) {} }, 1600)
    } catch (e) {
      try {
        setError(friendlyAuthMessage(e))
      } catch (mapErr) {
        setError(e.message || 'Authentication failed')
      }
    } finally { setLoading(false) }
  }

  return (
    <div className="auth-overlay">
      <div className="auth-card">
        <div className="logo">
          <img src="/Matte.png" alt="Matte" style={{ height: 48 }} />
        </div>
        <h1>Matte</h1>
        <p>{isLogin ? 'Sign in to your account' : 'Create a new account'}</p>

        {error && <div className="auth-error">{error}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          <input type="email" placeholder="Email" value={email} onChange={(e)=>setEmail(e.target.value)} required />

          <div className="password-wrapper">
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={(e)=>setPassword(e.target.value)}
              required
              minLength={6}
            />
            <button
              type="button"
              className="password-toggle"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword(s => !s)}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {!isLogin && (
            <div className="password-wrapper">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                placeholder="Confirm Password"
                value={confirmPassword}
                onChange={(e)=>setConfirmPassword(e.target.value)}
                required
                minLength={6}
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                onClick={() => setShowConfirmPassword(s => !s)}
              >
                {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          )}

          <button type="submit" className="login-action-button" disabled={loading}>{loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Sign Up')}</button>
        </form>

        <div className="auth-toggle">
          {isLogin ? (
            <>
              <button onClick={() => setIsLogin(false)}>Don't have an account? Sign up</button>
              <div style={{ marginTop: 8 }}><button onClick={() => { try { setAuthMessage(null) } catch (e) {} ; window.history.back() }}>Cancel</button></div>
            </>
          ) : (
            <>
              <button onClick={() => { setIsLogin(true); setError(null); setConfirmPassword('') }}>Already have an account? Sign in</button>
              <div style={{ marginTop: 8 }}><button onClick={() => window.history.back()}>Cancel</button></div>
            </>
          )}
        </div>
        </div>
      {authMessage && <div className="auth-note-overlay">{authMessage}</div>}
    </div>
  )
}
