'use client';

import type { JSX, ReactNode } from 'react';

interface EmptyStateProps {
  /** Big icon at the top — could be an emoji string or an inline SVG node */
  icon?: ReactNode;
  /** Headline */
  title: string;
  /** Optional descriptive text underneath */
  description?: string;
  /** Optional call-to-action button */
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps): JSX.Element {
  // Emoji strings render at text-5xl; nodes (SVGs) go in a w-16 h-16 container.
  const renderedIcon =
    typeof icon === 'string' ? (
      <div className="text-5xl leading-none mb-3" aria-hidden="true">
        {icon}
      </div>
    ) : icon ? (
      <div
        className="w-16 h-16 mb-3 flex items-center justify-center text-stone-400"
        aria-hidden="true"
      >
        {icon}
      </div>
    ) : null;

  return (
    <div
      role="status"
      className={`text-center py-12 max-w-sm mx-auto flex flex-col items-center ${className ?? ''}`}
    >
      {renderedIcon}
      <h3 className="text-base font-semibold text-stone-700">{title}</h3>
      {description && (
        <p className="text-sm text-stone-500 mt-2 leading-relaxed">{description}</p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-5 rounded-xl bg-teal-500 px-4 py-2.5 text-sm font-medium text-white active:scale-[0.98] transition-transform"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
