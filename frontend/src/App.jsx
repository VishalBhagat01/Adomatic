import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { StudioProvider } from './context/StudioContext';
import { AppRoutes } from './router/AppRoutes';

export function App() {
  return (
    <BrowserRouter>
      <StudioProvider>
        <AppRoutes />
      </StudioProvider>
    </BrowserRouter>
  );
}

export default App;
