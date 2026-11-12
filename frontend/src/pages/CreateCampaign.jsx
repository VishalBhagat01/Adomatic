import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Sparkles, AlertCircle, Image as ImageIcon, Film } from 'lucide-react';
import { Card, CardHeader } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { ProductPreviewPanel } from '../components/campaigns/ProductPreviewPanel';
import { productApi, campaignApi } from '../services/api';
import { useStudio, usePageTitle } from '../context/StudioContext';

const VIDEO_GENERATION_ENABLED =
  String(import.meta.env.VITE_ENABLE_VIDEO_GENERATION ?? 'false').toLowerCase() === 'true';

const PLACEMENT_OPTIONS = [
  { id: 'instagram_feed', label: 'Instagram Feed', hint: '1:1 or 4:5 carousel & static feed' },
  {
    id: 'instagram_reels',
    label: 'Instagram Reels',
    hint: VIDEO_GENERATION_ENABLED ? '9:16 vertical short-form video' : '9:16 vertical full-screen ad visual',
  },
  { id: 'facebook_feed', label: 'Facebook Feed', hint: '1:1 high-conversion feed placement' },
  {
    id: 'youtube_shorts',
    label: 'YouTube Shorts',
    hint: VIDEO_GENERATION_ENABLED ? '9:16 vertical video story' : '9:16 vertical mobile image card',
  },
  { id: 'google_display', label: 'Google Display', hint: '1:1 responsive visual unit' },
];

function validateProductUrlInput(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return 'Product URL is required.';
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'URL must start with https:// or http://.';
    }
    if (!parsed.hostname || parsed.hostname.length < 3) {
      return 'Enter a complete domain name.';
    }
    return '';
  } catch {
    return 'Enter a valid product URL (e.g. https://www.lifelongindiaonline.com/...).';
  }
}

export function CreateCampaign() {
  usePageTitle('Create Campaign');
  const navigate = useNavigate();
  const { announce } = useStudio();

  const urlInputRef = useRef(null);
  const promptInputRef = useRef(null);

  const [productUrl, setProductUrl] = useState('');
  const [userPrompt, setUserPrompt] = useState('');
  const [formats, setFormats] = useState(['image']);
  const [placements, setPlacements] = useState(['instagram_feed']);

  const [touched, setTouched] = useState({ url: false, prompt: false, submitted: false });
  const [submitError, setSubmitError] = useState(null);
  const [isLaunching, setIsLaunching] = useState(false);

  const [previewState, setPreviewState] = useState({ loading: false, error: null, data: null });
  const [selectedRefImages, setSelectedRefImages] = useState([]);

  const urlError = validateProductUrlInput(productUrl);
  const trimmedPrompt = userPrompt.trim();
  const promptError =
    trimmedPrompt.length > 0 && trimmedPrompt.length < 10
      ? 'If provided, description must be at least 10 characters (or leave blank).'
      : trimmedPrompt.length > 2000
        ? 'Description cannot exceed 2000 characters.'
        : '';
  const formatError = formats.length === 0 ? 'Select at least one creative format.' : '';
  const placementError = placements.length === 0 ? 'Select at least one placement.' : '';

  const showUrlError = (touched.url || touched.submitted) && Boolean(urlError);
  const showPromptError = (touched.prompt || touched.submitted) && Boolean(promptError);

  const toggleFormat = (fmt) => {
    if (fmt === 'video' && !VIDEO_GENERATION_ENABLED) {
      return;
    }
    setFormats((prev) =>
      prev.includes(fmt) ? prev.filter((item) => item !== fmt) : [...prev, fmt]
    );
  };

  const togglePlacement = (id) => {
    setPlacements((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleToggleReferenceImage = (url) => {
    setSelectedRefImages((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url]
    );
  };

  const handlePreviewProduct = async (forceJs = false) => {
    setTouched((prev) => ({ ...prev, url: true }));
    if (urlError) {
      urlInputRef.current?.focus();
      return;
    }

    setPreviewState({ loading: true, error: null, data: null });
    announce('Extracting product details for preview...');
    try {
      const res = await productApi.preview(productUrl.trim(), forceJs);
      const data = res.data;
      setPreviewState({ loading: false, error: null, data });
      const imgs = Array.isArray(data?.product?.images) ? data.product.images : [];
      setSelectedRefImages(imgs.slice(0, 4));
      announce(`Product preview loaded: ${data?.product?.product_name || 'complete'}`);
    } catch (err) {
      setPreviewState({ loading: false, error: err.message, data: null });
      announce(`Product preview failed: ${err.message}`);
    }
  };

  const handleLaunchCampaign = async (e) => {
    e.preventDefault();
    setTouched({ url: true, prompt: true, submitted: true });
    setSubmitError(null);

    if (urlError) {
      urlInputRef.current?.focus();
      return;
    }
    if (promptError) {
      promptInputRef.current?.focus();
      return;
    }
    if (formatError || placementError) {
      return;
    }

    setIsLaunching(true);
    announce('Creating and queueing advertising campaign...');
    try {
      const payload = {
        product_url: productUrl.trim(),
        user_prompt: trimmedPrompt,
        formats,
        placements,
      };
      if (previewState.data?.product) {
        payload.preview_product_data = previewState.data.product;
      }
      if (selectedRefImages.length > 0) {
        payload.reference_image_urls = selectedRefImages;
      }

      const key =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `camp_${Date.now()}`;

      const res = await campaignApi.create(payload, key);
      const created = res.data;
      announce('Campaign queued. Opening real-time workspace.');
      navigate(`/campaigns/${created.id}/workspace`);
    } catch (err) {
      setSubmitError(err.message || 'Could not launch campaign.');
      announce(`Campaign launch failed: ${err.message}`);
    } finally {
      setIsLaunching(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Create Campaign</h1>
        <p className="text-xs text-slate-400 mt-1">
          {VIDEO_GENERATION_ENABLED
            ? 'Preview extracted product intelligence first, then generate grounded image & video advertisements.'
            : 'Preview extracted product intelligence first, then generate grounded static image advertisements (video paused to save costs).'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Campaign Configuration Form */}
        <div className="lg:col-span-6">
          <Card>
            <CardHeader
              title="Campaign Brief"
              description="Configure product source, optional creative direction, formats, and placements."
            />

            <form noValidate onSubmit={handleLaunchCampaign} className="space-y-5">
              {/* 1. Product URL */}
              <div>
                <label htmlFor="product-url" className="block text-xs font-medium text-slate-200">
                  Product Page URL <span className="text-rose-400" aria-hidden="true">*</span>
                </label>
                <p id="product-url-hint" className="text-[11px] text-slate-400 mt-0.5 mb-2">
                  Enter a public HTTPS/HTTP product URL (e.g. lifelongindiaonline.com). Internal/private targets are blocked.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    ref={urlInputRef}
                    id="product-url"
                    name="product_url"
                    type="url"
                    required
                    value={productUrl}
                    onChange={(e) => setProductUrl(e.target.value)}
                    onBlur={() => setTouched((prev) => ({ ...prev, url: true }))}
                    placeholder="https://www.lifelongindiaonline.com/products/..."
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    aria-describedby={showUrlError ? 'product-url-hint product-url-error' : 'product-url-hint'}
                    aria-invalid={showUrlError}
                    className={`studio-input flex-1 ${showUrlError ? 'user-invalid-fallback' : ''}`}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    icon={Eye}
                    onClick={() => handlePreviewProduct(false)}
                    disabled={previewState.loading}
                    className="shrink-0"
                  >
                    {previewState.loading ? 'Extracting...' : 'Preview Product'}
                  </Button>
                </div>
                {showUrlError && (
                  <p
                    id="product-url-error"
                    className="mt-1.5 text-xs text-rose-400 flex items-center gap-1.5"
                  >
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>{urlError}</span>
                  </p>
                )}
              </div>

              {/* 2. Optional Advertisement Description */}
              <div>
                <label htmlFor="ad-description" className="block text-xs font-medium text-slate-200">
                  Desired Advertisement Description{' '}
                  <span className="text-slate-500 font-normal">(Optional)</span>
                </label>
                <p id="ad-description-hint" className="text-[11px] text-slate-400 mt-0.5 mb-2">
                  Specify tone, audience, or aesthetic style. Leave blank to let AdPilot infer a conversion-focused brief automatically.
                </p>
                <textarea
                  ref={promptInputRef}
                  id="ad-description"
                  name="user_prompt"
                  rows={4}
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                  onBlur={() => setTouched((prev) => ({ ...prev, prompt: true }))}
                  placeholder="Optional: Clean morning studio look targeting busy young professionals highlighting warranty and build quality..."
                  aria-describedby={
                    showPromptError ? 'ad-description-hint ad-description-error' : 'ad-description-hint'
                  }
                  aria-invalid={showPromptError}
                  className={`studio-input resize-y min-h-[96px] ${
                    showPromptError ? 'user-invalid-fallback' : ''
                  }`}
                />
                {showPromptError && (
                  <p
                    id="ad-description-error"
                    className="mt-1.5 text-xs text-rose-400 flex items-center gap-1.5"
                  >
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>{promptError}</span>
                  </p>
                )}
              </div>

              {/* 3. Format Selection */}
              <fieldset>
                <legend className="text-xs font-medium text-slate-200 mb-2">
                  Creative Formats
                </legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <label
                    className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                      formats.includes('image')
                        ? 'bg-indigo-500/10 border-indigo-500/40 text-white'
                        : 'bg-[#0b0e15] border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={formats.includes('image')}
                      onChange={() => toggleFormat('image')}
                      className="mt-0.5"
                    />
                    <div className="text-xs">
                      <div className="font-medium flex items-center gap-1.5">
                        <ImageIcon className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" />
                        Static Image Ads
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Multi-angle commercial product visuals
                      </p>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-2.5 p-3 rounded-lg border transition-colors ${
                      !VIDEO_GENERATION_ENABLED
                        ? 'bg-[#090c12] border-slate-800/80 text-slate-500 cursor-not-allowed opacity-75'
                        : formats.includes('video')
                          ? 'bg-indigo-500/10 border-indigo-500/40 text-white cursor-pointer'
                          : 'bg-[#0b0e15] border-slate-800 text-slate-300 hover:border-slate-700 cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={VIDEO_GENERATION_ENABLED && formats.includes('video')}
                      disabled={!VIDEO_GENERATION_ENABLED}
                      onChange={() => toggleFormat('video')}
                      className="mt-0.5"
                    />
                    <div className="text-xs">
                      <div className="font-medium flex flex-wrap items-center gap-1.5">
                        <Film
                          className={`w-3.5 h-3.5 ${VIDEO_GENERATION_ENABLED ? 'text-sky-400' : 'text-slate-500'}`}
                          aria-hidden="true"
                        />
                        <span>Video Ad Storyboard</span>
                        {!VIDEO_GENERATION_ENABLED && (
                          <span className="rounded bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                            Paused · Image-Only
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {VIDEO_GENERATION_ENABLED
                          ? 'Veo scene generation + FFmpeg MP4'
                          : 'Disabled to avoid paid Veo video generation limits'}
                      </p>
                    </div>
                  </label>
                </div>
                {touched.submitted && formatError && (
                  <p className="mt-1.5 text-xs text-rose-400 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>{formatError}</span>
                  </p>
                )}
              </fieldset>

              {/* 4. Placement Selection */}
              <fieldset>
                <legend className="text-xs font-medium text-slate-200 mb-2">
                  Target Ad Placements
                </legend>
                <div className="space-y-2">
                  {PLACEMENT_OPTIONS.map((pl) => {
                    const checked = placements.includes(pl.id);
                    return (
                      <label
                        key={pl.id}
                        className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border cursor-pointer text-xs transition-colors ${
                          checked
                            ? 'bg-indigo-500/10 border-indigo-500/35 text-slate-100'
                            : 'bg-[#0b0e15] border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePlacement(pl.id)}
                          />
                          <span className="font-medium">{pl.label}</span>
                        </div>
                        <span className="text-[11px] text-slate-500 hidden sm:inline">{pl.hint}</span>
                      </label>
                    );
                  })}
                </div>
                {touched.submitted && placementError && (
                  <p className="mt-1.5 text-xs text-rose-400 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>{placementError}</span>
                  </p>
                )}
              </fieldset>

              {submitError && (
                <div
                  role="alert"
                  className="rounded-lg bg-rose-950/40 border border-rose-500/30 p-3 text-xs text-rose-300 flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{submitError}</span>
                </div>
              )}

              <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <span className="text-[11px] text-slate-500">
                  {previewState.data?.product
                    ? 'Using verified previewed product data'
                    : 'Tip: Preview product first to inspect missing fields'}
                </span>
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  icon={Sparkles}
                  disabled={isLaunching}
                >
                  {isLaunching ? 'Launching Pipeline...' : 'Generate Campaign'}
                </Button>
              </div>
            </form>
          </Card>
        </div>

        {/* Right: Product Preview Panel */}
        <div className="lg:col-span-6">
          <ProductPreviewPanel
            previewState={previewState}
            onRunPreview={handlePreviewProduct}
            onToggleReferenceImage={handleToggleReferenceImage}
            selectedReferenceImages={selectedRefImages}
          />
        </div>
      </div>
    </div>
  );
}

