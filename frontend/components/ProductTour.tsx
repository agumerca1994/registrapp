"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { EventData, Step } from "react-joyride";

const Joyride = dynamic(() => import("react-joyride").then((mod) => mod.Joyride), { ssr: false });

export function tourSeenKey(tourId: string): string {
  return `tour_seen_${tourId}`;
}

export function resetTour(tourId: string): void {
  localStorage.removeItem(tourSeenKey(tourId));
}

export function resetAllTours(tourIds: string[]): void {
  tourIds.forEach(resetTour);
}

export default function ProductTour({ tourId, steps }: { tourId: string; steps: Step[] }) {
  const [run, setRun] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(tourSeenKey(tourId))) {
      setRun(true);
    }
  }, [tourId]);

  const handleEvent = (data: EventData) => {
    if (data.status === "finished" || data.status === "skipped") {
      localStorage.setItem(tourSeenKey(tourId), "1");
      setRun(false);
    }
  };

  if (!run) return null;

  return (
    <Joyride
      steps={steps}
      run={run}
      continuous
      scrollToFirstStep
      onEvent={handleEvent}
      locale={{ back: "Atrás", close: "Cerrar", last: "Finalizar", next: "Siguiente", skip: "Saltar" }}
      options={{
        buttons: ["back", "close", "primary", "skip"],
        showProgress: true,
        primaryColor: "hsl(221.2, 83.2%, 53.3%)",
        textColor: "#111827",
        zIndex: 10000,
      }}
    />
  );
}
