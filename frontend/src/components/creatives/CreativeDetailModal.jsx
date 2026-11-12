import React from 'react';
import { Link } from 'react-router-dom';
import { Download, Pencil, CheckCircle2, AlertTriangle, History, Film } from 'lucide-react';
import { ModalDialog } from '../common/ModalDialog';
import { Badge } from '../common/Badge';
import { StatusBadge } from '../common/StatusBadge';
import { Button } from '../common/Button';
import { creativeApi } from '../../services/api';

function formatCriterionLabel(name) {
  return String(name || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function CreativeDetailModal({ creative, open, onClose }) {
  if (!creative) return null;

  const mediaUrl = creativeApi.mediaSrc(creative.id, { cacheBust: creative.version || 1 });
  const downloadUrl = creativeApi.mediaSrc(creative.id, {
    download: true,
    cacheBust: creative.version || 1,
  });
  const evalData = creative.evaluation || null;
  const criteria = Array.isArray(evalData?.criteria_scores) ? evalData.criteria_scores : [];
  const versionHistory = Array.isArray(creative.versionHistory) ? creative.versionHistory : [];
  const adCopy = creative.adCopies?.[0] || null;

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title={creative.title || 'Creative Asset Inspection'}
      subtitle={`${creative.assetType?.toUpperCase()} · ${creative.placement || 'universal'} · Version ${creative.version || 1}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <a
            href={downloadUrl}
            download
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            Download Asset
          </a>
          <Link
            to={`/creatives/${creative.id}/edit`}
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
          >
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
            Open in Editor
          </Link>
        </>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left: Media Preview */}
        <div className="space-y-3">
          <div className="rounded-lg bg-[#090b10] border border-slate-800 overflow-hidden flex items-center justify-center min-h-[260px]">
            {creative.assetType === 'video' ? (
              <div className="w-full">
                <video
                  controls
                  preload="metadata"
                  src={mediaUrl}
                  className="w-full max-h-[380px] bg-black"
                />
                {creative.overlaySpec?.headline && (
                  <details className="px-3 py-2 text-xs text-slate-400 border-t border-slate-800">
                    <summary className="cursor-pointer font-medium text-slate-300">
                      Video script / overlay captions
                    </summary>
                    <p className="mt-1.5 text-slate-400">
                      Hook: {creative.overlaySpec.headline} · CTA: {creative.overlaySpec.cta || 'Shop Now'}
                    </p>
                  </details>
                )}
              </div>
            ) : (
              <img
                src={mediaUrl}
                alt={creative.title || 'Generated ad image'}
                className="w-full max-h-[420px] object-contain"
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <StatusBadge status={creative.approvalStatus} kind="approval" />
            <Badge variant="neutral" size="sm">
              {creative.aspectRatio || '1:1'}
            </Badge>
            {creative.dimensions?.width && (
              <Badge variant="neutral" size="sm">
                {creative.dimensions.width} × {creative.dimensions.height}
              </Badge>
            )}
            {creative.assetType === 'video' && (
              <Badge variant="info" size="sm">
                <Film className="w-3 h-3" aria-hidden="true" />
                {creative.durationSeconds ? `${creative.durationSeconds}s` : 'MP4'}
              </Badge>
            )}
          </div>

          {adCopy && (
            <div className="rounded-lg bg-[#0b0e15] border border-slate-800 p-3.5 space-y-2 text-xs">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Linked Ad Copy
              </div>
              <p className="text-sm font-medium text-white">{adCopy.headline}</p>
              <p className="text-slate-300 leading-relaxed">{adCopy.primaryText}</p>
              {adCopy.callToAction && (
                <Badge variant="purple" size="sm">
                  CTA: {adCopy.callToAction}
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Right: Evaluation Breakdown, Metadata, Version History */}
        <div className="space-y-4">
          <div className="rounded-lg bg-[#0b0e15] border border-slate-800 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Quality Evaluation
              </h3>
              {evalData?.overall_weighted_score !== undefined ? (
                <span className="text-sm font-semibold text-white tabular-nums">
                  {Number(evalData.overall_weighted_score).toFixed(1)} / 100
                </span>
              ) : (
                <span className="text-xs text-slate-500">Not scored</span>
              )}
            </div>

            {evalData?.hard_rejection_triggered && (
              <div className="flex items-center gap-2 text-xs text-rose-300 bg-rose-950/40 border border-rose-500/30 rounded-md px-3 py-2">
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Hard rejection rule triggered during QA inspection</span>
              </div>
            )}

            {criteria.length > 0 ? (
              <ul className="space-y-2.5">
                {criteria.map((item, idx) => {
                  const score = Number(item.score ?? item.raw_score ?? 0);
                  const pct = Math.max(0, Math.min(100, score <= 10 ? score * 10 : score));
                  return (
                    <li key={idx} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-300">{formatCriterionLabel(item.criterion)}</span>
                        <span className="font-mono text-slate-200">{score.toFixed(1)}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            pct >= 75 ? 'bg-emerald-500' : pct >= 55 ? 'bg-amber-500' : 'bg-rose-500'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      {item.rationale && <p className="text-[11px] text-slate-500">{item.rationale}</p>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">
                Detailed per-criterion scores appear once Stage 09 evaluation completes.
              </p>
            )}
          </div>

          <div className="rounded-lg bg-[#0b0e15] border border-slate-800 p-4 space-y-2 text-xs">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Creative Direction Metadata
            </h3>
            <dl className="space-y-1.5">
              {creative.marketingAngle && (
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Angle</dt>
                  <dd className="text-slate-200 text-right">{creative.marketingAngle}</dd>
                </div>
              )}
              {creative.audienceHypothesis && (
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Audience</dt>
                  <dd className="text-slate-200 text-right">{creative.audienceHypothesis}</dd>
                </div>
              )}
              {creative.backgroundDirection && (
                <div>
                  <dt className="text-slate-500">Background</dt>
                  <dd className="text-slate-300 mt-0.5">{creative.backgroundDirection}</dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Storage Key</dt>
                <dd className="font-mono text-[11px] text-slate-400 truncate max-w-[230px]">
                  {creative.storageKey}
                </dd>
              </div>
            </dl>
          </div>

          {versionHistory.length > 0 && (
            <div className="rounded-lg bg-[#0b0e15] border border-slate-800 p-4 space-y-2 text-xs">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <History className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Previous Versions ({versionHistory.length})</span>
              </div>
              <ul className="space-y-1.5">
                {versionHistory
                  .slice()
                  .reverse()
                  .map((v, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between gap-2 py-1.5 px-2.5 rounded bg-[#0f131b] border border-slate-800/70"
                    >
                      <span className="text-slate-200 font-medium">Version {v.version}</span>
                      <span className="text-slate-500">
                        {v.evaluation?.overall_weighted_score !== undefined
                          ? `Score ${Number(v.evaluation.overall_weighted_score).toFixed(1)}`
                          : v.approvalStatus}
                      </span>
                      <CheckCircle2 className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </ModalDialog>
  );
}

