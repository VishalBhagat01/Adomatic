import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  Activity,
  Trash2,
  RefreshCw,
  AlertCircle,
  Layers,
  RotateCcw,
} from 'lucide-react';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { StatusBadge, isCampaignInFlight } from '../components/common/StatusBadge';
import { ModalDialog } from '../components/common/ModalDialog';
import { campaignApi } from '../services/api';
import { useStudio, usePageTitle } from '../context/StudioContext';

export function Campaigns() {
  usePageTitle('Campaigns');
  const navigate = useNavigate();
  const { globalSearch, setGlobalSearch, announce } = useStudio();

  const [campaigns, setCampaigns] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await campaignApi.list({
        limit: 50,
        status: statusFilter,
        search: globalSearch.trim(),
      });
      setCampaigns(res.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, globalSearch]);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await campaignApi.remove(deleteTarget.id);
      announce(`Deleted campaign ${deleteTarget.name}`);
      setDeleteTarget(null);
      await loadCampaigns();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleRegenerate = async (campaign) => {
    try {
      await campaignApi.regenerate(campaign.id);
      announce(`Re-queued campaign ${campaign.name}`);
      navigate(`/campaigns/${campaign.id}/workspace`);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Campaigns</h1>
          <p className="text-xs text-slate-400 mt-1">
            Browse, monitor live executions, inspect strategy bundles, or trigger full campaign regeneration.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={loadCampaigns} disabled={loading}>
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
          <div className="sm:col-span-2">
            <label htmlFor="camp-search" className="block text-[11px] font-medium text-slate-400 mb-1">
              Search
            </label>
            <div className="relative">
              <Search
                className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                id="camp-search"
                type="search"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="Filter by product title, prompt, or URL..."
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                className="studio-input pl-9 text-xs py-2"
              />
            </div>
          </div>

          <div>
            <label htmlFor="camp-status" className="block text-[11px] font-medium text-slate-400 mb-1">
              Lifecycle Status
            </label>
            <select
              id="camp-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="studio-input text-xs py-2"
            >
              <option value="">All Statuses</option>
              <option value="QUEUED">Queued</option>
              <option value="EXTRACTING_PRODUCT">Extracting Product</option>
              <option value="GENERATING_STRATEGY">Generating Strategy</option>
              <option value="GENERATING_ASSETS">Generating Assets</option>
              <option value="EVALUATING_CREATIVES">Evaluating QA</option>
              <option value="COMPLETED">Completed</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>
        </div>
      </Card>

      {error && (
        <div
          role="alert"
          className="rounded-lg bg-rose-950/40 border border-rose-500/30 p-3.5 text-xs text-rose-200 flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={loadCampaigns}>
            Retry
          </Button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-slate-800/50" />
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <Card>
          <div className="py-12 px-4 text-center space-y-2.5">
            <Layers className="w-8 h-8 text-slate-600 mx-auto" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-slate-200">No campaigns found</h2>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Create your first product advertising campaign to extract specifications and generate image/video creatives.
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
        <div className="space-y-3">
          {campaigns.map((c) => (
            <Card key={c.id} hoverEffect>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Link
                      to={c.status === 'COMPLETED' ? `/campaigns/${c.id}` : `/campaigns/${c.id}/workspace`}
                      className="text-sm font-semibold text-white hover:text-indigo-300 truncate"
                    >
                      {c.name}
                    </Link>
                    <StatusBadge status={c.status} />
                    <span className="text-xs font-mono text-slate-400">{c.progress ?? 0}%</span>
                  </div>
                  <p className="text-xs text-slate-400 truncate max-w-2xl">{c.productUrl}</p>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span>Formats: {(c.formats || []).join(', ')}</span>
                    <span>·</span>
                    <span>Placements: {(c.placements || []).join(', ')}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Link
                    to={`/campaigns/${c.id}/workspace`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0b0e15] hover:bg-slate-800 border border-slate-800 text-xs text-slate-200"
                  >
                    <Activity className="w-3.5 h-3.5" aria-hidden="true" />
                    Workspace
                  </Link>
                  <Link
                    to={`/campaigns/${c.id}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/12 hover:bg-indigo-500/20 border border-indigo-500/30 text-xs font-medium text-indigo-200"
                  >
                    Details
                  </Link>
                  {!isCampaignInFlight(c.status) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={RotateCcw}
                      onClick={() => handleRegenerate(c)}
                      title="Regenerate full campaign"
                    >
                      Regenerate
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(c)}
                    className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/30"
                    aria-label={`Delete campaign ${c.name}`}
                    title="Delete campaign"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ModalDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete Campaign"
        subtitle="Soft-deletes campaign data from active tenant view."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={handleConfirmDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete Campaign'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Delete <strong className="text-white">{deleteTarget?.name}</strong>?
        </p>
      </ModalDialog>
    </div>
  );
}
