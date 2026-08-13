"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { setAmountsHidden } from "@/lib/utils";

/**
 * "Ocultar montos" — for handing someone the phone, or opening the app on a
 * screen other people can see.
 *
 * The flag itself lives in `lib/utils` so that every `formatARS`/`formatUSD`
 * in the app masks without its caller knowing. This provider owns the state,
 * persists the choice, and pushes it into that module **during render** so the
 * children below it format with the value they're about to be rendered with —
 * an effect would run after they've already painted the real numbers.
 */
const KEY = "registrapp:amountsHidden";

const PrivacyContext = createContext<{ hidden: boolean; toggle: () => void }>({
  hidden: false,
  toggle: () => {},
});

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  // Starts visible on the server and on the first client paint; reading
  // localStorage during render would desync hydration.
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(KEY) === "1") setHidden(true);
  }, []);

  setAmountsHidden(hidden);

  const toggle = useCallback(() => {
    setHidden(prev => {
      const next = !prev;
      localStorage.setItem(KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  return (
    <PrivacyContext.Provider value={{ hidden, toggle }}>
      {children}
    </PrivacyContext.Provider>
  );
}

export function usePrivacy() {
  return useContext(PrivacyContext);
}

/**
 * Subscribes a screen to the privacy flag. Every page that renders money must
 * call it, even if it ignores the return value.
 *
 * Setting the module flag in the provider is not enough on its own: the pages
 * arrive as the provider's `children` prop, so their element identity doesn't
 * change when the provider's state does and React skips re-rendering them —
 * the flag flips and the already-painted numbers stay. Reading the context
 * here is what subscribes the page and gets it repainted.
 */
export function useAmountsHidden(): boolean {
  return useContext(PrivacyContext).hidden;
}
