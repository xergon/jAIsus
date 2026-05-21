'use client';

import { useRef, useCallback, useEffect } from 'react';

/**
 * Configuration for {@link useLongPress}.
 *
 * Defaults are tuned for a chat-message context menu:
 * - 500ms feels intentional (shorter triggers on accidental holds).
 * - 10px movement budget tolerates a finger jitter without cancelling, while
 *   still letting a real scroll gesture escape cleanly.
 */
export interface UseLongPressOptions {
  /** ms to hold before triggering. Default 500ms. */
  threshold?: number;
  /** Called when the long-press fires. Receives the originating event for positioning. */
  onLongPress: (e: TouchEvent | MouseEvent) => void;
  /** Optional: also fire on right-click (default true) */
  enableRightClick?: boolean;
  /** Optional: pixels of movement allowed before cancelling. Default 10. */
  movementCancelThreshold?: number;
  /** Disable the hook entirely */
  disabled?: boolean;
}

/**
 * The bag of handlers returned by {@link useLongPress}, ready to spread on a
 * React element (e.g. `<div {...bind}>`).
 */
export interface UseLongPressBind {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchCancel: (e: React.TouchEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseUp: (e: React.MouseEvent) => void;
  onMouseLeave: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

/**
 * Detect a touch-and-hold (or right-click) gesture and invoke `onLongPress`
 * with the originating event so callers can position a context menu at the
 * pointer.
 *
 * Behavior:
 * - Touch and mouse hold both arm a timer at `threshold` ms.
 * - Movement past `movementCancelThreshold` pixels cancels — this lets a real
 *   scroll/drag gesture proceed without firing.
 * - On a successful long-press, the following `mouseup`/`touchend` calls
 *   `preventDefault()` so the parent's click handler doesn't also fire.
 *   (We do NOT preventDefault on `touchstart`/`touchmove` — scrolling must
 *    remain natural.)
 * - Right-click (`contextmenu`) fires immediately when `enableRightClick` is
 *   true, also calling `preventDefault()` to suppress the native menu.
 * - When `disabled` is true, all handlers are no-ops.
 * - Any pending timer is cleared on unmount.
 */
export function useLongPress({
  threshold = 500,
  onLongPress,
  enableRightClick = true,
  movementCancelThreshold = 10,
  disabled = false,
}: UseLongPressOptions): UseLongPressBind {
  // Mutable state we don't want to re-render on. A timer handle, the
  // pointer-down origin (for the movement-cancel check), and a flag set true
  // once the long-press actually fired (used to suppress the trailing click).
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const firedRef = useRef(false);

  // Keep the latest callback in a ref so the handlers below stay stable
  // across renders even if the caller passes an inline function.
  const onLongPressRef = useRef(onLongPress);
  useEffect(() => {
    onLongPressRef.current = onLongPress;
  }, [onLongPress]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Common arming logic shared by touchstart and mousedown.
  const start = useCallback(
    (x: number, y: number, nativeEvent: TouchEvent | MouseEvent) => {
      if (disabled) return;
      clearTimer();
      firedRef.current = false;
      startXRef.current = x;
      startYRef.current = y;
      timerRef.current = setTimeout(() => {
        firedRef.current = true;
        timerRef.current = null;
        onLongPressRef.current(nativeEvent);
      }, threshold);
    },
    [disabled, threshold, clearTimer]
  );

  // Common move logic — cancels the timer if the pointer wandered too far.
  const move = useCallback(
    (x: number, y: number) => {
      if (disabled) return;
      if (timerRef.current === null) return;
      const dx = x - startXRef.current;
      const dy = y - startYRef.current;
      if (dx * dx + dy * dy > movementCancelThreshold * movementCancelThreshold) {
        clearTimer();
      }
    },
    [disabled, movementCancelThreshold, clearTimer]
  );

  // Cleanup any pending timer when the consumer unmounts.
  useEffect(() => {
    return clearTimer;
  }, [clearTimer]);

  // --- Handlers exposed to the caller ---------------------------------------

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return;
      const t = e.touches[0];
      if (!t) return;
      start(t.clientX, t.clientY, e.nativeEvent);
    },
    [disabled, start]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return;
      const t = e.touches[0];
      if (!t) return;
      move(t.clientX, t.clientY);
    },
    [disabled, move]
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return;
      clearTimer();
      // If the long-press already fired, swallow the synthetic click that
      // follows the touchend so the parent's onClick doesn't also run.
      if (firedRef.current) {
        e.preventDefault();
        firedRef.current = false;
      }
    },
    [disabled, clearTimer]
  );

  const onTouchCancel = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return;
      clearTimer();
      if (firedRef.current) {
        e.preventDefault();
        firedRef.current = false;
      }
    },
    [disabled, clearTimer]
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      // Only react to the primary (left) button. Right-click is handled by
      // onContextMenu below; middle-click and other buttons are ignored.
      if (e.button !== 0) return;
      start(e.clientX, e.clientY, e.nativeEvent);
    },
    [disabled, start]
  );

  const onMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      clearTimer();
      if (firedRef.current) {
        e.preventDefault();
        firedRef.current = false;
      }
    },
    [disabled, clearTimer]
  );

  const onMouseLeave = useCallback(
    (_e: React.MouseEvent) => {
      if (disabled) return;
      // Pointer left the element before the timer expired — abandon the hold.
      // We don't reset `firedRef` here: if the press already fired, the next
      // mouseup will still want to suppress the click.
      clearTimer();
    },
    [disabled, clearTimer]
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      if (!enableRightClick) return;
      // Suppress the native menu and fire immediately. Right-click already
      // has the semantics we want, so there's no hold delay here.
      e.preventDefault();
      onLongPressRef.current(e.nativeEvent);
    },
    [disabled, enableRightClick]
  );

  return {
    onTouchStart,
    onTouchEnd,
    onTouchMove,
    onTouchCancel,
    onMouseDown,
    onMouseUp,
    onMouseLeave,
    onContextMenu,
  };
}
