import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Images,
  Film,
  Download,
  Pencil,
  Eye,
  RotateCw,
  RefreshCw,
  AlertCircle,
  Plus,
} from 'lucide-react';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { StatusBadge } from '../components/common/StatusBadge';
import { CreativeDetailModal } from '../components/creatives/CreativeDetailModal';
import { creativeApi, campaignApi } from '../services/api';
import { useStudio, usePageTitle } from '../context/StudioContext';

function CreativeMediaCard({ creative, onInspect, onQuickRegenerate, regeneratingId }) {
  const [mediaError, setMediaError] = useState(false);
  const src = creativeApi.mediaSrc(creative.id, { cacheBust: creative.version || 1 });
  const downloadHref = creativeApi.mediaSrc(creative.id, {
    download: true,
    cacheBust: creative.version || 1,
  });
  const score = creative.evaluation?.overall_weighted_score;
  const isRegenerating = regeneratingId === creative.id;

  return (
    <Card padded={false} hoverEffect className="overflow-hidden flex flex-col">
      {/* Preview Surface */}
      <div className="aspect-[4/3] bg-[#07090d] border-b border-slate-800/80 relative flex items-center justify-center overflow-hidden">
        {mediaError ? (
          <div className="text-center p-4 text-xs text-slate-500">
            {creative.assetType === 'video' ? (
              <Film className="w-7 h-7 mx-auto mb-1 text-slate-600" aria-hidden="true" />
            ) : (
              <Images className="w-7 h-7 mx-auto mb-1 text-slate-600" aria-hidden="true" />
            )}
            <p>Media object unavailable in local storage</p>
            <p className="font-mono text-[10px] text-slate-600 mt-1 truncate max-w-[200px]">
              {creative.storageKey}
            </p>
          </div>
        ) : creative.assetType === 'video' ? (
          <video
            controls
            preload="metadata"
            src={src}
            onError={() => setMediaError(true)}
            className="w-full h-full object-contain bg-black"
          />
        ) : (
          <img
            src={src}
            alt={creative.title || 'Generated ad image'}
            onError={() => setMediaError(true)}
            className="w-full h-full object-contain"
          />
        )}

        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
          <Badge variant={creative.assetType === 'video' ? 'info' : 'purple'} size="sm">
            {creative.assetType === 'video' ? 'Video' : 'Image'}
          </Badge>
          <Badge variant="neutral" size="sm">
            v{creative.version || 1}
          </Badge>
        </div>

        <div className="absolute top-2.5 right-2.5">
          <StatusBadge status={creative.approvalStatus} kind="approval" size="sm" />
        </div>
      </div>

      {/* Metadata & Actions */}
      <div className="p-4 flex-1 flex flex-col justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-sm font-semibold text-white line-clamp-1">{creative.title}</h2>
            {score !== undefined && (
              <span className="text-xs font-mono text-emerald-300 shrink-0 tabular-nums">
                {Number(score).toFixed(1)}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 truncate">
            {creative.campaignName || 'Campaign'} · {creative.placement} · {creative.aspectRatio}
          </p>
          {creative.adCopies?.[0]?.headline && (
            <p className="text-xs text-slate-300 line-clamp-2 pt-1">
              “{creative.adCopies[0].headline}”
            </p>
          )}
        </div>

        <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center gap-1.5">
          <Button variant="secondary" size="sm" icon={Eye} onClick={() => onInspect(creative)}>
            Inspect
          </Button>
          <Link
            to={`/creatives/${creative.id}/edit`}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600/15 hover:bg-indigo-600/25 text-indigo-200 border border-indigo-500/30 text-xs font-medium"
          >
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
            Edit
          </Link>
          <Button
            variant="ghost"
            size="sm"
            icon={RotateCw}
            disabled={isRegenerating}
            onClick={() => onQuickRegenerate(creative)}
            title="Regenerate this creative without restarting campaign"
          >
            {isRegenerating ? 'Regen...' : 'Regen'}
          </Button>
          <a
            href={downloadHref}
            download
            className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80"
            title="Download creative asset"
            aria-label={`Download ${creative.title}`}
          >
            <Download className="w-4 h-4" aria-hidden="true" />
          </a>
        </div>
      </div>
    </Card>
  );
}

export function CreativeGallery() {
  usePageTitle('Creative Gallery');
  const { announce } = useStudio();

  const [creatives, setCreatives] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [filters, setFilters] = useState({ assetType: '', approved: '', campaignId: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedCreative, setSelectedCreative] = useState(null);
  const [regeneratingId, setRegeneratingId] = useState(null);

  const fetchGallery = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [crRes, cpRes] = await Promise.all([
        creativeApi.list({
          assetType: filters.assetType,
          approved: filters.approved,
          campaignId: filters.campaignId,
          limit: 50,
        }),
        campaignApi.list({ limit: 50 }),
      ]);
      setCreatives(crRes.data || []);
      setCampaigns(cpRes.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchGallery();
  }, [fetchGallery]);

  const handleQuickRegenerate = async (creative) => {
    setRegeneratingId(creative.id);
    announce(`Regenerating ${creative.title}`);
    try {
      await creativeApi.regenerate(creative.id, {});
      announce(`${creative.title} regenerated as a new version`);
      await fetchGallery();
    } catch (err) {
      setError(`Selective regeneration failed: ${err.message}`);
    } finally {
      setRegeneratingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Creative Gallery</h1>
          <p className="text-xs text-slate-400 mt-1">
            Inspect image &amp; video previews, QA scores, version history, downloads, and single-asset regeneration.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={fetchGallery} disabled={loading}>
            Refresh
          </Button>
          <Link
            to="/campaigns/new"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            New Campaign
          </Link>
        </div>
      </div>

      {/* Filters */}
      <Card padded={false} className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="filter-format" className="block text-[11px] font-medium text-slate-400 mb-1">
              Format
            </label>
            <select
              id="filter-format"
              value={filters.assetType}
              onChange={(e) => setFilters((prev) => ({ ...prev, assetType: e.target.value }))}
              className="studio-input text-xs py-2"
            >
              <option value="">All Formats</option>
              <option value="image">Images</option>
              <option value="video">Videos</option>
            </select>
          </div>

          <div>
            <label htmlFor="filter-approval" className="block text-[11px] font-medium text-slate-400 mb-1">
              Approval Status
            </label>
            <select
              id="filter-approval"
              value={filters.approved}
              onChange={(e) => setFilters((prev) => ({ ...prev, approved: e.target.value }))}
              className="studio-input text-xs py-2"
            >
              <option value="">All Statuses</option>
              <option value="true">Approved Only</option>
              <option value="false">Needs Review / Rejected</option>
            </select>
          </div>

          <div>
            <label htmlFor="filter-campaign" className="block text-[11px] font-medium text-slate-400 mb-1">
              Campaign
            </label>
            <select
              id="filter-campaign"
              value={filters.campaignId}
              onChange={(e) => setFilters((prev) => ({ ...prev, campaignId: e.target.value }))}
              className="studio-input text-xs py-2"
            >
              <option value="">All Campaigns</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {error && (
        <div
          role="alert"
          className="rounded-lg bg-rose-950/40 border border-rose-500/30 p-3.5 text-xs text-rose-200 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={fetchGallery}>
            Retry
          </Button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 animate-pulse">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-80 rounded-xl bg-slate-800/50" />
          ))}
        </div>
      ) : creatives.length === 0 ? (
        <Card>
          <div className="py-12 px-4 text-center space-y-2.5">
            <Images className="w-8 h-8 text-slate-600 mx-auto" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-slate-200">No creatives match the current view</h2>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Launch a campaign to generate evaluated images, videos, and ad copy, or clear active gallery filters.
            </p>
            <div className="pt-2">
              <Link
                to="/campaigns/new"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                Create Campaign
              </Link>
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {creatives.map((cr) => (
            <CreativeMediaCard
              key={cr.id}
              creative={cr}
              onInspect={setSelectedCreative}
              onQuickRegenerate={handleQuickRegenerate}
              regeneratingId={regeneratingId}
            />
          ))}
        </div>
      )}

      <CreativeDetailModal
        creative={selectedCreative}
        open={Boolean(selectedCreative)}
        onClose={() => setSelectedCreative(null)}
      />
    </div>
  );
}

