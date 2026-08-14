"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Counts from where it is now up to `target`, so the hero figure arrives
 * instead of appearing.
 *
 * On mount that means 0 → the amount; when the month changes it means the
 * previous month's figure → the new one, which reads as the number moving
 * rather than being replaced. Cubic ease-out: most of the distance up front,
 * so it feels quick even at 800ms.
 *
 * Returns `target` verbatim under `prefers-reduced-motion`.
 */
export function useCountUp(target: number, duration = 800): number {
  const [display, setDisplay] = useState(0);
  // The animation restarts from whatever is on screen, not from the value it
  // was heading to — otherwise interrupting it mid-flight jumps.
  const current = useRef(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      current.current = target;
      setDisplay(target);
      return;
    }

    const origin = current.current;
    const delta = target - origin;
    if (delta === 0) return;

    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      current.current = origin + delta * eased;
      setDisplay(current.current);
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [target, duration]);

  return display;
}
