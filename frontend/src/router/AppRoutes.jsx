import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { Dashboard } from '../pages/Dashboard';
import { Campaigns } from '../pages/Campaigns';
import { CreateCampaign } from '../pages/CreateCampaign';
import { GenerationWorkspace } from '../pages/GenerationWorkspace';
import { CampaignDetails } from '../pages/CampaignDetails';
import { CreativeGallery } from '../pages/CreativeGallery';
import { CreativeEditor } from '../pages/CreativeEditor';
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
        <Route path="campaigns/new" element={<CreateCampaign />} />
        <Route path="campaigns/:id/workspace" element={<GenerationWorkspace />} />
        <Route path="campaigns/:id" element={<CampaignDetails />} />
        <Route path="creatives" element={<CreativeGallery />} />
        <Route path="creatives/:creativeId/edit" element={<CreativeEditor />} />
        <Route path="brand-assets" element={<BrandAssets />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="settings" element={<Settings />} />
        <Route path="404" element={<NotFound />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Route>
    </Routes>
  );
}
