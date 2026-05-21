'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (err: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Class component error boundary for the jAIsus app.
 *
 * Catches synchronous errors thrown during render, in lifecycle methods, and
 * in constructors of any child in the tree below it.
 *
 * IMPORTANT — what this does NOT catch:
 *   - Errors thrown inside event handlers (onClick, onChange, etc.)
 *   - Errors thrown inside async code (setTimeout, promise rejections, fetch
 *     handlers, audio/video callbacks, Web Speech API callbacks)
 *   - Errors thrown during server-side rendering
 *   - Errors thrown inside the boundary itself
 *
 * React deliberately does not propagate those to error boundaries — they must
 * be caught locally (try/catch) and surfaced via state if you want this
 * boundary to render the fallback. For an example wrapper pattern, see
 * https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
 *
 * Error boundaries must be class components because the trigger API
 * (`static getDerivedStateFromError` + `componentDidCatch`) has no functional
 * equivalent in React 19.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to the browser console so the user (or someone helping them) can
    // grab a stack trace without DevTools tooling installed.
    console.error('[ErrorBoundary] caught render error:', error);
    console.error('[ErrorBoundary] componentStack:', info.componentStack);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.hasError || this.state.error === null) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback(this.state.error, this.reset);
    }

    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-stone-50 px-6 py-12">
        <div className="w-full max-w-md rounded-2xl bg-white border border-stone-200 shadow-lg p-8 flex flex-col items-center text-center">
          {/* A small, dignified mark — a single soft line, like a held breath. */}
          <svg
            aria-hidden="true"
            viewBox="0 0 64 12"
            className="w-16 h-3 mb-6 text-amber-400"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M2 6 Q 18 2, 32 6 T 62 6" />
          </svg>

          <h1 className="font-serif text-2xl text-stone-800 mb-2">
            We hit a small bump.
          </h1>

          <p className="text-stone-600 text-base leading-relaxed mb-6">
            Something didn&rsquo;t go quite right on my end. The path of grace
            includes a stumble now and then. Let&rsquo;s try again together.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 w-full">
            <button
              type="button"
              onClick={this.reset}
              className="flex-1 rounded-xl bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white font-medium px-5 py-3 transition-colors shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="flex-1 rounded-xl bg-stone-100 hover:bg-stone-200 active:bg-stone-300 text-stone-700 font-medium px-5 py-3 transition-colors border border-stone-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50"
            >
              Reload the app
            </button>
          </div>

          <details className="mt-6 w-full text-left group">
            <summary className="cursor-pointer text-xs text-stone-400 hover:text-stone-600 transition-colors select-none list-none flex items-center gap-1.5">
              <span className="inline-block transition-transform group-open:rotate-90">
                &rsaquo;
              </span>
              <span>Technical details</span>
            </summary>
            <pre className="mt-3 text-xs text-stone-500 bg-stone-50 border border-stone-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words font-mono">
              {this.state.error.message || 'Unknown error'}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
