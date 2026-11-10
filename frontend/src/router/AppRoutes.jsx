import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { Dashboard } from '../pages/Dashboard';
import { Campaigns } from '../pages/Campaigns';
import { Creatives } from '../pages/Creatives';
import { BrandAssets } from '../pages/BrandAssets';
import { Analytics } from '../pages/Analytics';
import { Settings } from '../pages/Settings';
import { NotFound } from '../pages/NotFound';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="campaigns" element={<Campaigns />} />
        <Route path="creatives" element={<Creatives />} />
        <Route path="brand-assets" element={<BrandAssets />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="settings" element={<Settings />} />
        <Route path="404" element={<NotFound />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Route>
    </Routes>
  );
}

