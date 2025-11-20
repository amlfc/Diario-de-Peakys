
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './context/AuthContext';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
// Nota: Se ha eliminado React.StrictMode para evitar conflictos con Recharts y MutationObserver en React 18/19
root.render(
  <AuthProvider>
    <App />
  </AuthProvider>
);
