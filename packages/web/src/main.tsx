import { StrictMode } from 'react';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
