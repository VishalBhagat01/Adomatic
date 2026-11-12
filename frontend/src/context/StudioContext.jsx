import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { getAuthContext } from '../services/api';

const StudioContext = createContext(null);

export function StudioProvider({ children }) {
  const [identity, setIdentityState] = useState(() => getAuthContext());
  const [announcement, setAnnouncement] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');

  const setIdentity = useCallback((next) => {
    const clean = {
      tenantId: (next?.tenantId || 'tenant_default').trim() || 'tenant_default',
      userId: (next?.userId || '').trim(),
    };
    setIdentityState(clean);
    try {
      localStorage.setItem('adpilot.identity', JSON.stringify(clean));
    } catch {
      // Ignore storage persistence errors
    }
  }, []);

  const announce = useCallback((message) => {
    setAnnouncement('');
    requestAnimationFrame(() => {
      setAnnouncement(message);
    });
  }, []);

  return (
    <StudioContext.Provider
      value={{
        identity,
        setIdentity,
        announce,
        globalSearch,
        setGlobalSearch,
      }}
    >
      {children}
      <div aria-live="polite" aria-atomic="true" className="visually-hidden">
        {announcement}
      </div>
    </StudioContext.Provider>
  );
}

export function useStudio() {
  const ctx = useContext(StudioContext);
  if (!ctx) {
    throw new Error('useStudio must be used inside StudioProvider');
  }
  return ctx;
}

export function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} — AdPilot AI Studio` : 'AdPilot AI — Creative Studio';
  }, [title]);
}

