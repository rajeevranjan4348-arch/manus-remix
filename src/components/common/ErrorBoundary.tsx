import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, ChevronDown, ChevronRight, Home } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
  title?: string;
  description?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorInfo: null,
    showDetails: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  private toggleDetails = () => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const title = this.props.title || 'Something went wrong';
      const description =
        this.props.description ||
        'An unexpected error occurred while rendering this component. You can try refreshing the view or returning to safety.';

      return (
        <div className="flex flex-col items-center justify-center min-h-[280px] w-full p-6 text-center bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 shadow-2xl text-slate-200 transition-all duration-300 my-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mb-4 shadow-inner">
            <AlertTriangle className="w-6 h-6 animate-pulse" />
          </div>

          <h3 className="text-lg font-semibold text-white tracking-tight mb-2">
            {title}
          </h3>

          <p className="text-sm text-slate-400 max-w-md leading-relaxed mb-6">
            {description}
          </p>

          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={this.handleReset}
              className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 rounded-xl shadow-lg shadow-indigo-600/25 transition-all flex items-center gap-2"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Try Reloading
            </button>

            <button
              onClick={() => (window.location.href = '/')}
              className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-xl transition-all flex items-center gap-2"
            >
              <Home className="w-3.5 h-3.5" />
              Home
            </button>
          </div>

          {this.state.error && (
            <div className="w-full max-w-lg mt-2 text-left">
              <button
                onClick={this.toggleDetails}
                className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 mx-auto transition-colors py-1"
              >
                {this.state.showDetails ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                <span>Technical details</span>
              </button>

              {this.state.showDetails && (
                <div className="mt-2 p-3 bg-slate-950/90 rounded-xl border border-slate-800 text-[11px] font-mono text-rose-300 overflow-x-auto max-h-40 leading-relaxed shadow-inner">
                  <div className="font-semibold text-rose-400 mb-1">
                    {this.state.error.name}: {this.state.error.message}
                  </div>
                  {this.state.errorInfo?.componentStack && (
                    <pre className="text-slate-500 text-[10px] whitespace-pre-wrap mt-2">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
