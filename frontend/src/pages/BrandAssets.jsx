import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Palette, RefreshCw, Plus } from 'lucide-react';
import { Card, CardHeader } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { campaignApi } from '../services/api';
import { usePageTitle } from '../context/StudioContext';

export function BrandAssets() {
  usePageTitle('Brand & Product Assets');
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await campaignApi.list({ limit: 50 });
      const collected = [];
      for (const cp of res.data || []) {
        const imgs = Array.isArray(cp.productData?.images) ? cp.productData.images : [];
        for (const url of imgs) {
          collected.push({
            url,
            productName: cp.productData?.product_name || cp.name,
            campaignId: cp.id,
          });
        }
      }
      setImages(collected);
    } catch {
      setImages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Product Reference Assets</h1>
          <p className="text-xs text-slate-400 mt-1">
            Verified source product imagery ingested from previewed and executed campaigns.
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={loadAssets} disabled={loading}>
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader
          title="Extracted Product Reference Vault"
          description="Used as faithful visual anchors across Gemini image &amp; Veo video pipelines."
        />
        {images.length === 0 ? (
          <div className="py-10 text-center space-y-2.5">
            <Palette className="w-8 h-8 text-slate-600 mx-auto" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-200">No reference imagery ingested yet</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Preview or launch a campaign from a product page URL to populate verified product images here.
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
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-4">
            {images.map((item, idx) => (
              <Link
                key={`${item.url}-${idx}`}
                to={`/campaigns/${item.campaignId}`}
                className="rounded-lg bg-[#0b0e15] border border-slate-800 hover:border-indigo-500/40 overflow-hidden block"
              >
                <div className="aspect-square bg-black/40 p-2 flex items-center justify-center">
                  <img
                    src={item.url}
                    alt={item.productName}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="px-2.5 py-2 text-[11px] text-slate-300 truncate border-t border-slate-800">
                  {item.productName}
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
