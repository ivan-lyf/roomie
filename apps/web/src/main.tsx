import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { Toaster, TooltipProvider, WideEnough } from './ui/kit';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <WideEnough>
      <TooltipProvider>
        <App />
        <Toaster />
      </TooltipProvider>
    </WideEnough>
  </StrictMode>,
);
