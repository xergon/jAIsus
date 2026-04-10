'use client';

interface CommunityPlaceholderProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommunityPlaceholder({ isOpen, onClose }: CommunityPlaceholderProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-t-2xl shadow-2xl p-5 animate-slide-up">
        <div className="flex justify-center mb-3">
          <div className="w-10 h-1 rounded-full bg-stone-300" />
        </div>

        <div className="text-center py-10">
          <div className="text-5xl mb-3">👥</div>
          <h2 className="text-lg font-bold text-stone-800">Community</h2>
          <p className="text-sm text-stone-500 mt-2">
            A place to connect with others on their spiritual journey.
          </p>
          <p className="text-sm text-teal-600 font-medium mt-4">Coming Soon</p>
        </div>

        <button
          onClick={onClose}
          className="w-full rounded-xl border border-stone-200 py-2.5 text-sm font-medium text-stone-600
            active:scale-[0.98] transition-transform"
        >
          Close
        </button>
      </div>
    </div>
  );
}
