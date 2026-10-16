import './lib/blink'
import './lib/sentry'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { MotionIconConfig } from 'lucide-motion'
import * as Sentry from '@sentry/react'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary
      fallback={({ resetError }) => (
        <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-lg">
            <h1 className="text-lg font-semibold">Manus hit an unexpected error</h1>
            <p className="mt-2 text-sm text-muted-foreground">Your current session may still be available. Try recovering the app without refreshing the whole page.</p>
            <button
              type="button"
              onClick={resetError}
              className="mt-5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Try again
            </button>
          </div>
        </div>
      )}
    >
      <MotionIconConfig mode="signature">
        <App />
      </MotionIconConfig>
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
)
