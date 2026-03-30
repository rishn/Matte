import React, { useEffect } from 'react'
import { BrowserRouter } from 'react-router-dom'
import AppLayout from './AppLayout'
import { useStore } from './store/useStore'
import './App.css'

function App() {
  const { undo, redo } = useStore()

  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        undo()
      } else if (e.ctrlKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo])

  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  )
}

export default App
