import React, { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Header from './components/Header'
import ToolsPanel from './components/ToolsPanel'
import Canvas from './components/Canvas'
import Projects from './pages/Projects'
import Login from './pages/Login'
import Profile from './pages/Profile'
import VerifyEmail from './pages/VerifyEmail'
import PropertiesPanel from './components/PropertiesPanel'
import LayersPanel from './components/LayersPanel'
import Footer from './components/Footer'
import { useStore } from './store/useStore'
import Toast from './components/Toast'

function mapPathToPage(path) {
  if (!path) return 'editor'
  if (path.startsWith('/projects')) return 'projects'
  if (path.startsWith('/login')) return 'login'
  if (path.startsWith('/profile')) return 'profile'
  return 'editor'
}

export default function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const setActivePage = useStore(state => state.setActivePage)
  const activePage = useStore(state => state.activePage)

  // Keep store.activePage in sync with URL path
  useEffect(() => {
    const p = mapPathToPage(location.pathname)
    if (p !== activePage) setActivePage(p)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  // When the store's activePage changes (e.g., UI actions), update the URL
  useEffect(() => {
    const p = activePage || 'editor'
    // editor is root '/'
    const target = p === 'projects' ? '/projects' : p === 'login' ? '/login' : p === 'profile' ? '/profile' : '/'
    if (location.pathname !== target) {
      // push navigation so browser back/forward works naturally
      navigate(target)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage])

  // parse URL for Firebase action code (oobCode). If present, render inline verify page.
  const search = typeof window !== 'undefined' ? window.location.search : ''
  const params = new URLSearchParams(search)
  const oobCode = params.get('oobCode')
  const mode = params.get('mode')

  const pathname = location.pathname

  return (
    <div className="app">
      <Toast />
      {pathname !== '/login' && <Header />}

      {oobCode ? (
        <div className="page-content"><VerifyEmail oobCode={oobCode} mode={mode} /></div>
      ) : pathname === '/projects' ? (
        <div className="page-content"><Projects /></div>
      ) : pathname === '/login' ? (
        <div className="page-content"><Login /></div>
      ) : pathname === '/profile' ? (
        <div className="page-content"><Profile /></div>
      ) : (
        // Editor workspace stays mounted — we only toggle visibility
        <div className="workspace" style={{ display: pathname === '/editor' ? 'flex' : 'flex' }} aria-hidden={pathname !== '/editor'}>
          <ToolsPanel />
          <Canvas />
          <div className="right-panel">
            <PropertiesPanel />
            <LayersPanel />
          </div>
        </div>
      )}

      {pathname !== '/login' && <Footer />}
    </div>
  )
}
