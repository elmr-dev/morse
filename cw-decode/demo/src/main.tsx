import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import Footer from './components/Footer'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <div className="min-h-screen flex flex-col">
        <div className="w-full max-w-[900px] mx-auto px-5 pt-4">
          <App />
        </div>
        <div className="mt-auto">
          <Footer />
        </div>
      </div>
    </BrowserRouter>
  </StrictMode>,
)

// Remove the static pre-mount loader (in index.html) once React has mounted,
// and cancel its delayed reveal so it never flashes on fast/cached loads.
clearTimeout((window as unknown as { __loaderTimer?: number }).__loaderTimer)
document.getElementById('app-loader')?.remove()
