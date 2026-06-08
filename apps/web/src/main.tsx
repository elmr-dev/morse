import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './app.tsx';
import Footer from './components/footer';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');
createRoot(rootEl).render(
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
  </StrictMode>
);
