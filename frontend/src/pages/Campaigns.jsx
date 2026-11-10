import React from 'react';
import { Card, CardHeader } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { Plus, Filter, Layers } from 'lucide-react';

export function Campaigns() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Ad Campaigns</h2>
          <p className="text-xs text-slate-400 mt-1">
            Manage your e-commerce advertising campaigns across Meta, Google, and TikTok.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" icon={Filter}>
            Filter
          </Button>
          <Button variant="primary" size="sm" icon={Plus}>
            Create Campaign
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Campaign Pipeline"
          description="Campaign execution will be enabled in subsequent pipeline stages."
        />
        <div className="py-12 text-center">
          <div className="w-12 h-12 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto mb-3">
            <Layers className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-semibold text-slate-200">No campaigns active yet</h4>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
            The foundation is configured. AI-driven creative generation and campaign synthesis will connect here in Step 02.
          </p>
        </div>
      </Card>
    </div>
  );
}

