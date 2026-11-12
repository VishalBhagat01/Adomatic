import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  Tag,
  Image as ImageIcon,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardHeader } from '../common/Card';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';

export function ProductPreviewPanel({
  previewState,
  onRunPreview,
  onToggleReferenceImage,
  selectedReferenceImages = [],
}) {
  const { loading, error, data } = previewState;
  const product = data?.product || null;
  const warnings = data?.warnings || [];
  const missingFields = data?.missingFields || [];
  const images = Array.isArray(product?.images) ? product.images : [];
  const [activeImageIdx, setActiveImageIdx] = useState(0);

  useEffect(() => {
    setActiveImageIdx(0);
  }, [product?.product_name, images.length]);

  if (!loading && !error && !product) {
    return (
      <Card>
        <CardHeader
          title="Product Preview"
          description="Inspect extracted product title, images, pricing, specs, and warnings before generating ads."
        />
        <div className="py-10 px-4 text-center border border-dashed border-slate-800 rounded-lg bg-[#0b0e15]">
          <ImageIcon className="w-8 h-8 text-slate-600 mx-auto mb-2.5" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-300">No product extracted yet</p>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Enter an e-commerce product URL on the left and click{' '}
            <strong className="text-slate-300">Preview Product</strong> to verify extracted details
            before launching generation.
          </p>
        </div>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardHeader
          title="Extracting Product Intelligence..."
          description="Validating URL, parsing structured schema, and checking reference images."
        />
        <div className="space-y-4 animate-pulse" aria-busy="true">
          <div className="aspect-[4/3] rounded-lg bg-slate-800/60" />
          <div className="h-5 w-2/3 bg-slate-800/70 rounded" />
          <div className="h-4 w-1/3 bg-slate-800/50 rounded" />
          <div className="grid grid-cols-2 gap-2">
            <div className="h-12 bg-slate-800/50 rounded" />
            <div className="h-12 bg-slate-800/50 rounded" />
          </div>
        </div>
      </Card>
    );
  }

  if (error && !product) {
    return (
      <Card>
        <CardHeader title="Product Preview Failed" />
        <div
          role="alert"
          className="rounded-lg bg-rose-950/40 border border-rose-500/30 p-4 space-y-3"
        >
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-rose-200">Unable to extract product page</p>
              <p className="text-xs text-rose-300/80 mt-1 break-words">{error}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => onRunPreview(false)}>
              Retry Preview
            </Button>
            <Button variant="outline" size="sm" onClick={() => onRunPreview(true)}>
              Retry with JS Renderer
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const activeImage = images[activeImageIdx] || null;
  const specsEntries = product?.specifications ? Object.entries(product.specifications) : [];

  return (
    <Card className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-white">Product Preview</h2>
            <Badge variant="success" size="sm">
              Ready
            </Badge>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Verify extracted facts and select reference images to guide creative fidelity.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          icon={RefreshCw}
          onClick={() => onRunPreview(true)}
          title="Re-extract page using headless browser if dynamic content is missing"
        >
          JS Re-extract
        </Button>
      </div>

      {/* Product Image Gallery */}
      <div className="space-y-2.5">
        <div className="aspect-[16/10] rounded-lg bg-[#0b0e15] border border-slate-800/80 overflow-hidden flex items-center justify-center relative">
          {activeImage ? (
            <img
              src={activeImage}
              alt={product.product_name || 'Product reference'}
              className="w-full h-full object-contain p-2"
            />
          ) : (
            <div className="text-center p-6">
              <ImageIcon className="w-8 h-8 text-slate-600 mx-auto mb-2" aria-hidden="true" />
              <p className="text-xs text-slate-500">No product reference images detected</p>
            </div>
          )}
        </div>

        {images.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {images.map((url, idx) => {
              const isSelected = selectedReferenceImages.includes(url);
              const isActive = idx === activeImageIdx;
              return (
                <div key={`${url}-${idx}`} className="shrink-0 flex flex-col items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setActiveImageIdx(idx)}
                    className={`w-16 h-16 rounded-lg overflow-hidden border bg-[#0b0e15] transition-colors ${
                      isActive ? 'border-indigo-500' : 'border-slate-800 hover:border-slate-600'
                    }`}
                    aria-label={`Preview product image ${idx + 1}`}
                  >
                    <img
                      src={url}
                      alt={`${product.product_name || 'Product'} view ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </button>
                  <label className="inline-flex items-center gap-1 text-[10px] text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleReferenceImage(url)}
                      className="rounded border-slate-700 bg-slate-900"
                    />
                    <span>Use</span>
                  </label>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Core Metadata: Title, Brand, Category, Pricing */}
      <div className="space-y-3 pt-1 border-t border-slate-800/80">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mb-1">
            {product.brand && <Badge variant="purple" size="sm">{product.brand}</Badge>}
            {product.category && <Badge variant="neutral" size="sm">{product.category}</Badge>}
            {product.availability && (
              <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px]">
                <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                {product.availability}
              </span>
            )}
          </div>
          <h3 className="text-base font-semibold text-white">{product.product_name || 'Untitled Product'}</h3>
          {product.description && (
            <p className="text-xs text-slate-400 mt-1.5 line-clamp-3 leading-relaxed">
              {product.description}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-[#0b0e15] border border-slate-800/80">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-indigo-400" aria-hidden="true" />
            {product.price !== null && product.price !== undefined ? (
              <div className="flex items-baseline gap-2">
                <span className="text-base font-semibold text-white">
                  {product.currency || ''} {product.price}
                </span>
                {product.original_price && (
                  <span className="text-xs text-slate-500 line-through">
                    {product.currency || ''} {product.original_price}
                  </span>
                )}
                {product.discount && <Badge variant="success" size="sm">{product.discount}</Badge>}
              </div>
            ) : (
              <span className="text-xs text-slate-400">Pricing not available on page</span>
            )}
          </div>

          {product.rating !== null && product.rating !== undefined && (
            <div className="ml-auto text-xs text-slate-300">
              Rating: <strong className="text-white">{product.rating}</strong>
              {product.review_count ? ` (${product.review_count} reviews)` : ''}
            </div>
          )}
        </div>
      </div>

      {/* Extracted Features & Specifications */}
      {Array.isArray(product.features) && product.features.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Extracted Features
          </h4>
          <ul className="space-y-1 text-xs text-slate-300 list-disc pl-4">
            {product.features.slice(0, 6).map((feat, i) => (
              <li key={i}>{feat}</li>
            ))}
          </ul>
        </div>
      )}

      {specsEntries.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Specifications
          </h4>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {specsEntries.slice(0, 8).map(([k, v]) => (
              <div
                key={k}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-[#0b0e15] border border-slate-800/70"
              >
                <dt className="text-slate-400 truncate">{k}</dt>
                <dd className="text-slate-200 font-medium text-right truncate">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* Missing Fields & Extraction Warnings */}
      {(warnings.length > 0 || missingFields.length > 0) && (
        <div className="rounded-lg bg-amber-950/30 border border-amber-500/30 p-3.5 space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Extraction Diagnostics &amp; Missing Fields</span>
          </div>

          {missingFields.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {missingFields.map((field) => (
                <Badge key={field} variant="warning" size="sm">
                  Missing: {field}
                </Badge>
              ))}
            </div>
          )}

          {warnings.length > 0 && (
            <ul className="space-y-1 text-xs text-amber-200/80 list-disc pl-4">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {data?.diagnostics?.source_url && (
        <div className="text-[11px] text-slate-500 flex items-center justify-between pt-1">
          <span>Method: {data.diagnostics.extraction_method || 'structured'}</span>
          <a
            href={data.diagnostics.source_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300"
          >
            Source Page <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>
        </div>
      )}
    </Card>
  );
}

