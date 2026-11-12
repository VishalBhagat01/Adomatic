import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Save,
  RotateCw,
  ArrowLeft,
  Download,
  History,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { Card, CardHeader } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { StatusBadge } from '../components/common/StatusBadge';
import { creativeApi } from '../services/api';
import { useStudio, usePageTitle } from '../context/StudioContext';

export function CreativeEditor() {
  const { creativeId } = useParams();
  usePageTitle('Creative Editor');
  const { announce } = useStudio();

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const [form, setForm] = useState({
    title: '',
    headline: '',
    headlinesText: '',
    primaryText: '',
    callToAction: '',
    overlayHeadline: '',
    overlaySubheadline: '',
    overlayCta: '',
    backgroundDirection: '',
    creativeInstructions: '',
    approvalStatus: 'needs_review',
    aspectRatio: '1:1',
  });

  const populateForm = useCallback((data) => {
    const cr = data.creative;
    const copy = data.adCopies?.[0] || {};
    const extraHeadlines = Array.isArray(copy.headlines) ? copy.headlines : [];

    setForm({
      title: cr.title || '',
      headline: copy.headline || cr.overlaySpec?.headline || cr.hook || '',
      headlinesText: extraHeadlines.join('\n'),
      primaryText: copy.primaryText || cr.mainMessage || '',
      callToAction: copy.callToAction || cr.overlaySpec?.cta || 'Shop Now',
      overlayHeadline: cr.overlaySpec?.headline || cr.hook || '',
      overlaySubheadline: cr.overlaySpec?.subheadline || cr.mainMessage || '',
      overlayCta: cr.overlaySpec?.cta || copy.callToAction || 'Shop Now',
      backgroundDirection: cr.backgroundDirection || '',
      creativeInstructions: cr.creativeInstructions || '',
      approvalStatus: cr.approvalStatus || 'needs_review',
      aspectRatio: cr.aspectRatio || '1:1',
    });
  }, []);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await creativeApi.get(creativeId);
      setDetail(res.data);
      populateForm(res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [creativeId, populateForm]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const buildPayload = () => {
    const parsedHeadlines = form.headlinesText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const headlines = form.headline.trim()
      ? Array.from(new Set([form.headline.trim(), ...parsedHeadlines]))
      : parsedHeadlines;

    return {
      title: form.title.trim() || undefined,
      headline: form.headline.trim() || undefined,
      headlines: headlines.length > 0 ? headlines : undefined,
      primaryText: form.primaryText.trim() || undefined,
      callToAction: form.callToAction.trim() || undefined,
      overlaySpec: {
        headline: form.overlayHeadline.trim(),
        subheadline: form.overlaySubheadline.trim(),
        cta: form.overlayCta.trim(),
      },
      backgroundDirection: form.backgroundDirection.trim(),
      creativeInstructions: form.creativeInstructions.trim(),
      approvalStatus: form.approvalStatus,
    };
  };

  const handleSaveMetadata = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await creativeApi.update(creativeId, buildPayload());
      setDetail(res.data);
      populateForm(res.data);
      setNotice('Saved copy, overlays, and studio direction.');
      announce('Creative edits saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSelectiveRegenerate = async () => {
    setRegenerating(true);
    setError(null);
    setNotice(null);
    announce('Regenerating this individual creative without restarting campaign...');
    try {
      const payload = {
        ...buildPayload(),
        aspectRatio: form.aspectRatio,
      };
      const res = await creativeApi.regenerate(creativeId, payload);
      setDetail(res.data);
      populateForm(res.data);
      setNotice(`Generated Version ${res.data.creative.version}. Previous version preserved in history.`);
      announce(`Creative regenerated cleanly as version ${res.data.creative.version}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setRegenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-56 bg-slate-800/70 rounded" />
        <div className="h-96 bg-slate-800/50 rounded-xl" />
      </div>
    );
  }

  if (error && !detail) {
    return (
      <Card>
        <div role="alert" className="py-10 text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-rose-400 mx-auto" aria-hidden="true" />
          <h1 className="text-base font-semibold text-white">Unable to open Creative Editor</h1>
          <p className="text-xs text-slate-400">{error}</p>
          <Button variant="secondary" size="sm" onClick={loadDetail}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  const cr = detail.creative;
  const mediaUrl = creativeApi.mediaSrc(cr.id, { cacheBust: cr.version || 1 });
  const downloadUrl = creativeApi.mediaSrc(cr.id, { download: true, cacheBust: cr.version || 1 });
  const versionHistory = Array.isArray(cr.versionHistory) ? cr.versionHistory : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Link to="/creatives" className="inline-flex items-center gap-1 hover:text-white">
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
              Creative Gallery
            </Link>
            {detail.campaign && (
              <>
                <span>/</span>
                <Link to={`/campaigns/${detail.campaign.id}`} className="hover:text-white truncate max-w-[220px]">
                  {detail.campaign.name}
                </Link>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold text-white">Creative Editor</h1>
            <Badge variant="neutral" size="sm">Version {cr.version || 1}</Badge>
            <StatusBadge status={cr.approvalStatus} kind="approval" size="sm" />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={downloadUrl}
            download
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            Download v{cr.version || 1}
          </a>
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className="rounded-lg bg-emerald-950/35 border border-emerald-500/30 p-3 text-xs text-emerald-200 flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg bg-rose-950/40 border border-rose-500/30 p-3 text-xs text-rose-200 flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Asset Preview & Version History */}
        <div className="lg:col-span-5 space-y-5">
          <Card padded={false} className="overflow-hidden">
            <div className="aspect-square bg-[#07090d] flex items-center justify-center border-b border-slate-800/80">
              {cr.assetType === 'video' ? (
                <video controls preload="metadata" src={mediaUrl} className="w-full h-full object-contain bg-black" />
              ) : (
                <img src={mediaUrl} alt={cr.title} className="w-full h-full object-contain" />
              )}
            </div>
            <div className="p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Placement / Aspect</span>
                <span className="text-slate-200 font-medium">
                  {cr.placement} · {cr.aspectRatio}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Evaluation Score</span>
                <span className="font-mono text-emerald-300">
                  {cr.evaluation?.overall_weighted_score !== undefined
                    ? `${Number(cr.evaluation.overall_weighted_score).toFixed(1)} / 100`
                    : 'Not evaluated'}
                </span>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title={`Version History (${versionHistory.length + 1})`}
              description="Regenerating this asset preserves prior iterations."
              action={<History className="w-4 h-4 text-slate-400" aria-hidden="true" />}
            />
            <ul className="space-y-2 text-xs">
              <li className="p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-between">
                <span className="font-medium text-indigo-200">Version {cr.version || 1} (Current)</span>
                <StatusBadge status={cr.approvalStatus} kind="approval" size="sm" />
              </li>
              {versionHistory
                .slice()
                .reverse()
                .map((v, idx) => (
                  <li
                    key={idx}
                    className="p-2.5 rounded-lg bg-[#0b0e15] border border-slate-800 flex items-center justify-between text-slate-400"
                  >
                    <span>Version {v.version}</span>
                    <span>
                      {v.evaluation?.overall_weighted_score !== undefined
                        ? `Score ${Number(v.evaluation.overall_weighted_score).toFixed(1)}`
                        : v.approvalStatus}
                    </span>
                  </li>
                ))}
            </ul>
          </Card>
        </div>

        {/* Right Column: Copy, Overlays, Background & Creative Instructions Form */}
        <div className="lg:col-span-7">
          <Card>
            <CardHeader
              title="Edit Creative Copy &amp; Visual Direction"
              description="Update text overlays and ad copy instantly, or trigger selective regeneration for just this creative."
            />

            <form onSubmit={handleSaveMetadata} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="ed-title" className="block text-xs font-medium text-slate-300 mb-1">
                    Creative Title
                  </label>
                  <input
                    id="ed-title"
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                    className="studio-input"
                  />
                </div>

                <div>
                  <label htmlFor="ed-approval" className="block text-xs font-medium text-slate-300 mb-1">
                    QA Approval Status
                  </label>
                  <select
                    id="ed-approval"
                    value={form.approvalStatus}
                    onChange={(e) => setForm((p) => ({ ...p, approvalStatus: e.target.value }))}
                    className="studio-input"
                  >
                    <option value="approved">Approved</option>
                    <option value="needs_review">Needs Review</option>
                    <option value="rejected">Rejected</option>
                    <option value="pending">Pending QA</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800/70 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Advertising Copy
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label htmlFor="ed-headline" className="block text-xs font-medium text-slate-300 mb-1">
                      Primary Headline
                    </label>
                    <input
                      id="ed-headline"
                      type="text"
                      value={form.headline}
                      onChange={(e) => setForm((p) => ({ ...p, headline: e.target.value }))}
                      className="studio-input"
                    />
                  </div>
                  <div>
                    <label htmlFor="ed-cta" className="block text-xs font-medium text-slate-300 mb-1">
                      Call to Action (CTA)
                    </label>
                    <input
                      id="ed-cta"
                      type="text"
                      value={form.callToAction}
                      onChange={(e) => setForm((p) => ({ ...p, callToAction: e.target.value }))}
                      placeholder="Shop Now"
                      className="studio-input"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="ed-primary-text" className="block text-xs font-medium text-slate-300 mb-1">
                    Primary Ad Copy Text
                  </label>
                  <textarea
                    id="ed-primary-text"
                    rows={3}
                    value={form.primaryText}
                    onChange={(e) => setForm((p) => ({ ...p, primaryText: e.target.value }))}
                    className="studio-input"
                  />
                </div>

                <div>
                  <label htmlFor="ed-alt-headlines" className="block text-xs font-medium text-slate-300 mb-1">
                    Headline Variations (one per line)
                  </label>
                  <textarea
                    id="ed-alt-headlines"
                    rows={2}
                    value={form.headlinesText}
                    onChange={(e) => setForm((p) => ({ ...p, headlinesText: e.target.value }))}
                    className="studio-input text-xs font-mono"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800/70 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Visual Overlays &amp; Regeneration Direction
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="ed-ov-headline" className="block text-xs font-medium text-slate-300 mb-1">
                      Overlay Headline
                    </label>
                    <input
                      id="ed-ov-headline"
                      type="text"
                      value={form.overlayHeadline}
                      onChange={(e) => setForm((p) => ({ ...p, overlayHeadline: e.target.value }))}
                      className="studio-input"
                    />
                  </div>
                  <div>
                    <label htmlFor="ed-ov-sub" className="block text-xs font-medium text-slate-300 mb-1">
                      Overlay Subtext
                    </label>
                    <input
                      id="ed-ov-sub"
                      type="text"
                      value={form.overlaySubheadline}
                      onChange={(e) => setForm((p) => ({ ...p, overlaySubheadline: e.target.value }))}
                      className="studio-input"
                    />
                  </div>
                  <div>
                    <label htmlFor="ed-ov-cta" className="block text-xs font-medium text-slate-300 mb-1">
                      Overlay CTA Button
                    </label>
                    <input
                      id="ed-ov-cta"
                      type="text"
                      value={form.overlayCta}
                      onChange={(e) => setForm((p) => ({ ...p, overlayCta: e.target.value }))}
                      className="studio-input"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label htmlFor="ed-bg" className="block text-xs font-medium text-slate-300 mb-1">
                      Background Direction
                    </label>
                    <input
                      id="ed-bg"
                      type="text"
                      value={form.backgroundDirection}
                      onChange={(e) => setForm((p) => ({ ...p, backgroundDirection: e.target.value }))}
                      placeholder="Warm matte limestone counter with subtle side daylight"
                      className="studio-input"
                    />
                  </div>
                  <div>
                    <label htmlFor="ed-aspect" className="block text-xs font-medium text-slate-300 mb-1">
                      Aspect Ratio
                    </label>
                    <select
                      id="ed-aspect"
                      value={form.aspectRatio}
                      onChange={(e) => setForm((p) => ({ ...p, aspectRatio: e.target.value }))}
                      className="studio-input"
                    >
                      <option value="1:1">1:1 (Square Feed)</option>
                      <option value="4:5">4:5 (Portrait Feed)</option>
                      <option value="9:16">9:16 (Reels / Shorts)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="ed-instructions" className="block text-xs font-medium text-slate-300 mb-1">
                    Creative Steering Instructions
                  </label>
                  <textarea
                    id="ed-instructions"
                    rows={3}
                    value={form.creativeInstructions}
                    onChange={(e) => setForm((p) => ({ ...p, creativeInstructions: e.target.value }))}
                    placeholder="Instructions applied specifically when regenerating this asset (e.g. softer shadow, emphasize metallic trim)..."
                    className="studio-input"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <Button type="submit" variant="secondary" size="md" icon={Save} disabled={saving || regenerating}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  icon={RotateCw}
                  onClick={handleSelectiveRegenerate}
                  disabled={regenerating || saving}
                >
                  {regenerating ? 'Regenerating Creative...' : 'Regenerate Only This Creative'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}

