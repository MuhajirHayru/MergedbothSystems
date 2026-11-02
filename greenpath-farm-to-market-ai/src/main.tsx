import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ThemeProvider } from './context/ThemeContext';
import { AppProvider } from './context/AppContext';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <AppProvider>
      <App />
    </AppProvider>
  </ThemeProvider>
);
