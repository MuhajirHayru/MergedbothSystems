import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface State {
  error: Error | null;
}

/**
 * Catches rendering errors so a single failing screen can never blank the
 * whole application. The fallback keeps the shell and navigation usable.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; label?: string },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep the real error visible in the console for diagnosis; the UI below
    // never pretends the page loaded successfully.
    console.error('Screen failed to render:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="rounded-2xl border border-red-200 dark:border-red-900 bg-white dark:bg-slate-900 p-6 space-y-4">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertTriangle className="w-5 h-5" />
            <h2 className="text-base font-bold">
              {this.props.label || 'This screen could not be displayed'}
            </h2>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            The page hit an unexpected error. Nothing was saved or changed. You can retry
            the screen, or reload the application.
          </p>
          <pre className="text-[11px] whitespace-pre-wrap break-words rounded-lg bg-slate-50 dark:bg-slate-800 p-3 text-slate-700 dark:text-slate-300">
            {this.state.error.message}
          </pre>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="px-4 py-2 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry screen
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              Reload application
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
