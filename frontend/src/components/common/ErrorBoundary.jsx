import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from './Button';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="rounded-xl bg-[#0f131b] border border-rose-500/30 p-6 max-w-lg mx-auto my-10 text-center space-y-4"
        >
          <div className="w-11 h-11 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Studio panel encountered an unexpected error</h2>
            <p className="text-xs text-slate-400 mt-1 break-words">
              {this.state.error?.message || 'Unable to render this view cleanly.'}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={RotateCcw}
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Reload Section
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

