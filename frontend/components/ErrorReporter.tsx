"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/report-error";

export function ErrorReporter() {
  useEffect(() => {
    const handler = (event: ErrorEvent) => {
      console.error("[ErrorReporter] Uncaught error:", event.message, event.error);
      reportError(event.error ?? event.message);
    };
    const rejectionHandler = (event: PromiseRejectionEvent) => {
      console.error("[ErrorReporter] Unhandled promise rejection:", event.reason);
      reportError(event.reason);
    };
    window.addEventListener("error", handler);
    window.addEventListener("unhandledrejection", rejectionHandler);
    return () => {
      window.removeEventListener("error", handler);
      window.removeEventListener("unhandledrejection", rejectionHandler);
    };
  }, []);
  return null;
}
