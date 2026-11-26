import './lib/blink'
import './lib/sentry'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './manus-motion.css'
import './icon-motion.css'
import { initIconMotion } from './lib/iconMotion'

// Tier 1 Google Maps Platform auth & quota detection (registered before React mount)
if (typeof window !== 'undefined') {
  (window as any).gm_authFailure = () => {
    window.dispatchEvent(new CustomEvent('gmp-auth-failure'))
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'))
  }
  const origConsoleError = console.error
  console.error = (...args: unknown[]) => {
    origConsoleError.apply(console, args)
    const msg = args.map((a) => String(a)).join(' ')
    if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'))
    }
  }

  // Universal icon motion system (src/icon-motion.css + src/lib/iconMotion.ts):
  // tag dynamically rendered icons so they inherit the shared animation layer.
  initIconMotion()
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
