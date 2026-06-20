"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function ScrollToTop() {
  const pathname = usePathname();
  useEffect(() => {
    document.getElementById("main-content")?.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);
  return null;
}