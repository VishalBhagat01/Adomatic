import React, { useEffect, useState } from 'react';
import { ModalDialog } from '../common/ModalDialog';
import { Button } from '../common/Button';
import { metaApi } from '../../services/api';

export function CreativeMappingModal({
  open,
  targetRow,
  campaigns = [],
  creatives = [],
  onClose,
  onSaved,
}) {
  const [origin, setOrigin] = useState('adpilot_generated');
  const [campaignId, setCampaignId] = useState('');
  const [creativeId, setCreativeId] = useState('');
  const [creativeTitle, setCreativeTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!targetRow) return;
    setOrigin(targetRow.origin || 'external_meta');
    setCampaignId(targetRow.adPilotCampaignId || '');
    setCreativeId(targetRow.adPilotCreativeId || '');
    setCreativeTitle(targetRow.adPilotCreativeTitle || targetRow.metaAdName || '');
    setError(null);
  }, [targetRow]);

  const filteredCreatives = campaignId
    ? creatives.filter((c) => String(c.campaignId) === String(campaignId))
    : creatives;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!targetRow) return;
    setSubmitting(true);
    setError(null);

    try {
      await metaApi.createMapping({
        meta_ad_account_id: targetRow.metaAdAccountId,
        meta_ad_id: targetRow.metaAdId,
        meta_ad_name: targetRow.metaAdName || '',
        meta_campaign_id: targetRow.metaCampaignId || '',
        meta_campaign_name: targetRow.metaCampaignName || '',
        meta_creative_id: targetRow.metaCreativeId || '',
        origin,
        adpilot_campaign_id: origin === 'external_meta' ? null : campaignId || null,
        adpilot_creative_id: origin === 'adpilot_generated' ? creativeId || null : null,
        creative_title: creativeTitle,
      });
      if (onSaved) await onSaved();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to update creative mapping');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Link Meta Ad to AdPilot Creative"
      subtitle={targetRow ? `Meta Ad ID ${targetRow.metaAdId} (${targetRow.metaAdAccountId})` : ''}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="map-origin" className="block text-xs font-medium text-slate-300 mb-1">
            Creative Origin
          </label>
          <select
            id="map-origin"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            className="studio-input text-xs"
          >
            <option value="adpilot_generated">AdPilot AI Generated Creative</option>
            <option value="uploaded_creative">Uploaded Studio Creative (Linked to Campaign)</option>
            <option value="external_meta">External Native Meta Advertisement</option>
          </select>
        </div>

        {origin !== 'external_meta' ? (
          <div>
            <label htmlFor="map-campaign" className="block text-xs font-medium text-slate-300 mb-1">
              AdPilot Campaign
            </label>
            <select
              id="map-campaign"
              value={campaignId}
              onChange={(e) => {
                setCampaignId(e.target.value);
                setCreativeId('');
              }}
              className="studio-input text-xs"
            >
              <option value="">Select AdPilot Campaign...</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.id.slice(-6)})
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {origin === 'adpilot_generated' ? (
          <div>
            <label htmlFor="map-creative" className="block text-xs font-medium text-slate-300 mb-1">
              AdPilot Creative Asset
            </label>
            <select
              id="map-creative"
              value={creativeId}
              onChange={(e) => setCreativeId(e.target.value)}
              className="studio-input text-xs"
            >
              <option value="">Select AdPilot Creative...</option>
              {filteredCreatives.map((cr) => (
                <option key={cr.id} value={cr.id}>
                  {cr.title || cr.placement} ({cr.format} · {cr.id.slice(-6)})
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div>
          <label htmlFor="map-title" className="block text-xs font-medium text-slate-300 mb-1">
            Display Title
          </label>
          <input
            id="map-title"
            type="text"
            value={creativeTitle}
            onChange={(e) => setCreativeTitle(e.target.value)}
            placeholder="Creative title in analytics"
            className="studio-input text-xs"
          />
        </div>

        {error ? (
          <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-md px-3 py-2">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={submitting}>
            {submitting ? 'Saving...' : 'Save Lineage Mapping'}
          </Button>
        </div>
      </form>
    </ModalDialog>
  );
}
