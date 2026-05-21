'use client';

import type { JSX } from 'react';

interface SkeletonProps {
  /** CSS class for sizing (height/width via Tailwind, e.g. "h-4 w-32") */
  className?: string;
  /** Visual variant — defaults to 'text' */
  variant?: 'text' | 'circle' | 'rect';
  /** Number of repeated lines (only used when variant='text'). Defaults to 1. */
  lines?: number;
}

/**
 * Inline keyframes + animation style — gradient sweep across a stone-200 base.
 * Defined locally so we don't have to touch globals.css.
 * `motion-reduce:animate-none` ensures users with reduced-motion get a static block.
 */
const SHIMMER_STYLE: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(90deg, rgb(231 229 228) 0%, rgb(245 245 244) 50%, rgb(231 229 228) 100%)',
  backgroundSize: '200% 100%',
  animation: 'jaisusSkeletonShimmer 1.5s ease-in-out infinite',
};

const KEYFRAMES = `@keyframes jaisusSkeletonShimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
@media (prefers-reduced-motion: reduce) {
  [data-jaisus-skeleton] { animation: none !important; background-image: none !important; background-color: rgb(231 229 228) !important; }
}`;

function ShimmerKeyframes(): JSX.Element {
  // Inline <style> so the keyframes exist without editing globals.css.
  // Repeated mounts are fine — browsers de-duplicate identical rules.
  return <style>{KEYFRAMES}</style>;
}

export function Skeleton({
  className,
  variant = 'text',
  lines = 1,
}: SkeletonProps): JSX.Element {
  // variant='circle' — caller controls size via className
  if (variant === 'circle') {
    return (
      <>
        <ShimmerKeyframes />
        <div
          data-jaisus-skeleton
          aria-hidden="true"
          className={`rounded-full bg-stone-200 motion-reduce:animate-none ${className ?? ''}`}
          style={SHIMMER_STYLE}
        />
      </>
    );
  }

  // variant='rect' — rounded card-like block
  if (variant === 'rect') {
    return (
      <>
        <ShimmerKeyframes />
        <div
          data-jaisus-skeleton
          aria-hidden="true"
          className={`rounded-xl bg-stone-200 motion-reduce:animate-none ${className ?? ''}`}
          style={SHIMMER_STYLE}
        />
      </>
    );
  }

  // variant='text' — one or more text-line bars
  const count = Math.max(1, lines);
  if (count === 1) {
    return (
      <>
        <ShimmerKeyframes />
        <div
          data-jaisus-skeleton
          aria-hidden="true"
          className={`h-3 rounded bg-stone-200 motion-reduce:animate-none ${className ?? ''}`}
          style={SHIMMER_STYLE}
        />
      </>
    );
  }

  return (
    <>
      <ShimmerKeyframes />
      <div className={`space-y-2 ${className ?? ''}`} aria-hidden="true">
        {Array.from({ length: count }).map((_, i) => {
          const isLast = i === count - 1;
          return (
            <div
              key={i}
              data-jaisus-skeleton
              aria-hidden="true"
              className={`h-3 rounded bg-stone-200 motion-reduce:animate-none ${
                isLast ? 'w-3/4' : 'w-full'
              }`}
              style={SHIMMER_STYLE}
            />
          );
        })}
      </div>
    </>
  );
}

/** Mimics a ChatMessage layout — small jAIsus label + 3 lines of text. */
export function SkeletonMessage(): JSX.Element {
  return (
    <div className="flex justify-start animate-fade-in" aria-hidden="true">
      <div className="max-w-[90%] w-full">
        <div className="flex items-center gap-1.5 mb-1">
          <Skeleton variant="text" className="h-2.5 w-14" />
        </div>
        <div className="bg-white border border-stone-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
          <Skeleton variant="text" lines={3} />
        </div>
      </div>
    </div>
  );
}

/** A rounded-2xl card with a heading bar + a few lines of content. */
export function SkeletonCard({ className }: { className?: string }): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={`bg-white border border-stone-200 rounded-2xl px-4 py-4 shadow-sm ${className ?? ''}`}
    >
      <Skeleton variant="text" className="h-4 w-1/2 mb-3" />
      <Skeleton variant="text" lines={3} />
    </div>
  );
}
