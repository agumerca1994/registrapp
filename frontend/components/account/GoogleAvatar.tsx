"use client";

import { useState } from "react";
import { CircleUserRound } from "lucide-react";
import { cn } from "@/lib/utils";

/** La foto de la cuenta con la que se entró. Sin foto, o si no carga, un ícono. */
export function GoogleAvatar({ photoURL, className }: { photoURL?: string | null; className?: string }) {
  const [errored, setErrored] = useState(false);
  if (photoURL && !errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoURL}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setErrored(true)}
        className={cn("rounded-full object-cover shrink-0", className)}
      />
    );
  }
  return (
    <div className={cn("rounded-full bg-accent text-primary flex items-center justify-center shrink-0", className)}>
      <CircleUserRound className="w-[65%] h-[65%]" />
    </div>
  );
}
