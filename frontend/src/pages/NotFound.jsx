import React from 'react';
import { NavLink } from 'react-router-dom';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Home, AlertTriangle } from 'lucide-react';

export function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <Card className="max-w-md w-full text-center py-10">
        <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-white font-['Plus_Jakarta_Sans']">
          Page Not Found
        </h2>
        <p className="text-xs text-slate-400 mt-2 mb-6">
          The view you requested does not exist or has been moved.
        </p>
        <NavLink to="/">
          <Button variant="primary" icon={Home}>
            Return to Dashboard
          </Button>
        </NavLink>
      </Card>
    </div>
  );
}

