"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

// Pre-login is the one screen with no chrome around it, so it carries the
// brand itself: a full-bleed violet field instead of the app's off-white
// background. It's painted with layered radial gradients rather than blurred
// blob divs — same look, no `filter: blur()` over rounded corners, which is
// what broke on real iOS/Safari before.
const BRAND_FIELD =
  "radial-gradient(120% 80% at 15% -10%, #7B6DF5 0%, rgba(123,109,245,0) 60%)," +
  "radial-gradient(90% 60% at 110% 105%, #3F34A8 0%, rgba(63,52,168,0) 55%)," +
  "linear-gradient(165deg, #5B4FE9 0%, #4A3FC4 55%, #3D338F 100%)";

function GoogleIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

// Isotipo: three ascending bars (the app is a ledger that goes up over time).
// Plain rects only — no strokes, filters or clipping that a mobile browser
// could render differently from the desktop one.
function BrandMark() {
  return (
    <svg viewBox="0 0 40 40" className="w-10 h-10" aria-hidden="true">
      <rect x="5" y="24" width="8" height="12" rx="3" fill="#fff" fillOpacity="0.55" />
      <rect x="16" y="16" width="8" height="20" rx="3" fill="#fff" fillOpacity="0.8" />
      <rect x="27" y="6" width="8" height="30" rx="3" fill="#fff" />
    </svg>
  );
}

export default function LoginPage() {
  const { firebaseUser, appUser, loading, loginWithGoogle } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (firebaseUser && appUser) router.replace("/dashboard");
    else if (firebaseUser && !appUser) router.replace("/onboarding");
  }, [firebaseUser, appUser, loading, router]);

  // Coming back from the Google redirect there's a moment where the session is
  // already valid and the route hasn't changed yet. Showing the welcome screen
  // there reads as "the login didn't take" — say what's happening instead.
  const entering = loading || !!firebaseUser;

  return (
    <div
      className="min-h-screen flex flex-col text-white"
      style={{
        background: BRAND_FIELD,
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* Three elements only, as one centred column: mark, slogan, button.
          The screen's whole job is the button — anything else on it competes
          with the only action there is. */}
      <main className="flex-1 w-full max-w-sm mx-auto px-6 py-10 flex flex-col items-center justify-center text-center">
        <div className="w-20 h-20 rounded-2xl bg-white/15 border-2 border-white/30 shadow-[4px_4px_0_0_rgba(255,255,255,0.22)] flex items-center justify-center">
          <BrandMark />
        </div>

        <h1 className="mt-7 font-display font-bold text-4xl tracking-tight">RegistrApp</h1>
        <p className="mt-3 text-[15px] text-white/80 leading-snug max-w-[17rem]">
          Tus finanzas del hogar, claras y al día
        </p>

        <Button
          variant="outline"
          onClick={loginWithGoogle}
          disabled={entering}
          className="mt-12 w-full h-14 gap-3 text-base font-semibold"
        >
          <GoogleIcon />
          {entering ? "Entrando…" : "Ingresa con tu cuenta de Google"}
        </Button>
      </main>
    </div>
  );
}
