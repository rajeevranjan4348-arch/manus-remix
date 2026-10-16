import './lib/blink'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { MotionIconConfig } from 'lucide-motion'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MotionIconConfig mode="signature">
      <App />
    </MotionIconConfig>
  </React.StrictMode>,
)
