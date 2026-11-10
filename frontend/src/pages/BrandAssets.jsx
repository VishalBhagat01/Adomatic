import React from 'react';
import { Card, CardHeader } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Palette, Upload } from 'lucide-react';

export function BrandAssets() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Brand Kit & Assets</h2>
          <p className="text-xs text-slate-400 mt-1">
            Store brand logos, color guidelines, typography, and product imagery.
          </p>
        </div>
        <Button variant="primary" size="sm" icon={Upload}>
          Upload Asset
        </Button>
      </div>

      <Card>
        <CardHeader
          title="Brand Asset Vault"
          description="E-commerce asset management and brand consistency controls."
        />
        <div className="py-12 text-center">
          <div className="w-12 h-12 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center mx-auto mb-3">
            <Palette className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-semibold text-slate-200">Asset Vault Empty</h4>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
            Brand guidelines will be ingested by the agent service for automated stylistic compliance.
          </p>
        </div>
      </Card>
    </div>
  );
}

