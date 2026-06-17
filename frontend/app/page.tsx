"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

export default function Home() {
  const { firebaseUser, appUser, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser) {
      router.replace("/login");
    } else if (!appUser) {
      router.replace("/onboarding");
    } else {
      router.replace("/dashboard");
    }
  }, [firebaseUser, appUser, loading, router]);

  return null;
}
