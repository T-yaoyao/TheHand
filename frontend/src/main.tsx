import React from 'react'
import ReactDOM from 'react-dom/client'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import './index.css'
import { App } from './App'

// Register GSAP plugins
gsap.registerPlugin(useGSAP)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
