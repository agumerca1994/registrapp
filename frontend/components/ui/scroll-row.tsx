"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A row of tiles or chips that scrolls sideways instead of wrapping or
 * squashing.
 *
 * The scrollbar is hidden, so the row nudges itself once on first paint to say
 * it moves — hiding the bar without replacing the affordance leaves the
 * content off-screen with nothing hinting it's there. The nudge only plays
 * when the content actually overflows: a row that fits and wiggles anyway is
 * just noise.
 *
 * Children should be `shrink-0` (or `flex-1` with a `min-w-*`, which spreads
 * them when few and scrolls when many).
 */
export function ScrollRow({ children, className = "", gap = "gap-3" }: {
  children: React.ReactNode;
  className?: string;
  gap?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // 4px of slack: sub-pixel layout rounding otherwise reports a 1px overflow
    // on rows that visibly fit.
    const check = () => setOverflows(el.scrollWidth > el.clientWidth + 4);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children]);

  return (
    <div ref={box} className={`overflow-x-auto no-scrollbar ${className}`}>
      <div className={`flex ${gap} min-w-full ${overflows ? "animate-scroll-hint" : ""}`}>
        {children}
      </div>
    </div>
  );
}
