import React from 'react';
import { Card, CardHeader } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Sparkles, Wand2 } from 'lucide-react';

export function Creatives() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Creative Studio</h2>
          <p className="text-xs text-slate-400 mt-1">
            Generate high-converting advertising creatives with multi-agent orchestration.
          </p>
        </div>
        <Button variant="primary" size="sm" icon={Wand2}>
          Generate New Creative
        </Button>
      </div>

      <Card>
        <CardHeader
          title="Creative Generation Studio"
          description="Ready for LangGraph multi-agent generative pipelines."
        />
        <div className="py-12 text-center">
          <div className="w-12 h-12 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center mx-auto mb-3">
            <Sparkles className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-semibold text-slate-200">Creative Studio Shell Ready</h4>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
            Agent service on port 8000 is online and awaiting creative orchestration workflows.
          </p>
        </div>
      </Card>
    </div>
  );
}

