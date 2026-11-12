import React from 'react';
import { Link } from 'react-router-dom';
import { Home, AlertTriangle } from 'lucide-react';
import { Card } from '../components/common/Card';
import { usePageTitle } from '../context/StudioContext';

export function NotFound() {
  usePageTitle('Page Not Found');

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <Card className="max-w-md w-full text-center py-10">
        <div className="w-11 h-11 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-5 h-5" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-white">Page Not Found</h1>
        <p className="text-xs text-slate-400 mt-2 mb-6">
          The requested studio route does not exist or has been moved.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
        >
          <Home className="w-3.5 h-3.5" aria-hidden="true" />
          Return to Dashboard
        </Link>
      </Card>
    </div>
  );
}
