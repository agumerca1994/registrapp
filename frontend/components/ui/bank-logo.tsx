"use client";

import { useState } from "react";
import { Landmark } from "lucide-react";
import { cn } from "@/lib/utils";
import { findBank } from "@/lib/banks";

// Real per-domain icon via Google's public favicon service (no API key).
// Quality is whatever favicon the bank's site actually serves — a small
// square icon, not necessarily a polished wordmark logo — but it's a real
// icon from the entity, unlike a from-scratch replica. Falls back to a
// colored initials badge (or a generic icon for freeform "Otro" banks not
// in the curated list) if there's no domain on file or the icon fails to
// load.
export function BankLogo({ bankName, size = 32, className }: { bankName: string; size?: number; className?: string }) {
  const [errored, setErrored] = useState(false);
  const bank = findBank(bankName);

  if (bank && !errored) {
    return (
      <div
        className={cn("rounded-xl bg-white flex items-center justify-center p-1.5 shrink-0 overflow-hidden", className)}
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://www.google.com/s2/favicons?domain=${bank.domain}&sz=128`}
          alt={bank.name}
          className="w-full h-full object-contain"
          onError={() => setErrored(true)}
        />
      </div>
    );
  }

  const words = bankName.trim().split(/\s+/);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : bankName.trim().slice(0, 2)).toUpperCase();
  return (
    <div
      className={cn("rounded-xl flex items-center justify-center font-bold text-white shrink-0", className)}
      style={{ width: size, height: size, backgroundColor: bank?.color || "#64748b", fontSize: size * 0.38 }}
    >
      {bank ? initials : <Landmark className="w-[55%] h-[55%]" />}
    </div>
  );
}
