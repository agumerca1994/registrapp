"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import Sidebar from "@/components/layout/Sidebar";
import { ScrollToTop } from "@/components/ScrollToTop";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { firebaseUser, appUser, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser) router.replace("/login");
    else if (!appUser) router.replace("/onboarding");
  }, [firebaseUser, appUser, loading, router]);

  if (loading || !appUser) return null;

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <ScrollToTop />
      <main id="main-content" className="flex-1 p-4 md:p-8 overflow-auto pt-16 md:pt-8">
        {children}
      </main>
    </div>
  );
}