import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './app.tsx';
import Footer from './components/footer';
import ScrollToTop from './components/scroll-to-top';
import { MobileTabBar } from './components/site-nav';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');
createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ScrollToTop />
      {/* pb on mobile reserves room for the fixed bottom tab bar so content
          and footer never hide behind it; cleared at sm where the bar is hidden. */}
      <div className="min-h-screen flex flex-col pb-20 sm:pb-0">
        <div className="w-full max-w-[900px] mx-auto px-5 pt-4">
          <App />
        </div>
        <div className="mt-auto">
          <Footer />
        </div>
      </div>
      <MobileTabBar />
    </BrowserRouter>
  </StrictMode>
);
