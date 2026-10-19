import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const container = document.getElementById('root');

if (!container) {
  // Failing loudly is better than a blank page: this only happens when
  // index.html has been edited to remove the mount point.
  throw new Error('FinRisk AI could not start: #root is missing from index.html.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
