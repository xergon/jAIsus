'use client';

import { useFavorites } from '@/hooks/useFavorites';
import type { Favorite } from '@/lib/favorites';

interface Props {
  kind: Favorite['kind'];
  content: string;
  context?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function FavoriteButton({
  kind,
  content,
  context,
  size = 'sm',
  className = '',
}: Props) {
  const { isFavorited, toggle } = useFavorites();
  const favorited = isFavorited(kind, content);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Don't bubble — these often sit inside larger clickable cards.
    e.stopPropagation();
    toggle({ kind, content, context });
  };

  const dimensions = size === 'md' ? 'w-11 h-11' : 'w-9 h-9';
  const iconSize = size === 'md' ? 22 : 18;

  const label = favorited ? 'Remove from favorites' : 'Save to favorites';

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      aria-pressed={favorited}
      title={label}
      className={[
        dimensions,
        'inline-flex items-center justify-center rounded-full',
        'transition-transform duration-150 ease-out',
        'active:scale-90',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60',
        // No backdrop per spec — button stands alone.
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill={favorited ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={favorited ? 0 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={[
          'transition-colors duration-200 ease-out',
          favorited
            ? 'text-rose-500 animate-[pulse_2s_ease-in-out_infinite]'
            : 'text-stone-400',
        ].join(' ')}
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
  );
}
