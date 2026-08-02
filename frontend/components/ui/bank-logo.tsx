"use client";

import { useState } from "react";
import { Landmark } from "lucide-react";
import { cn } from "@/lib/utils";
import { findBank } from "@/lib/banks";

// Resolves a real bank logo by domain (via Clearbit's public logo lookup,
// no API key required) for banks in the curated ARGENTINE_BANKS list.
// Always wrapped in a white chip so an arbitrarily-colored external logo
// stays legible regardless of what it's placed on (a colored card gradient,
// a form row, etc). Falls back to an initials badge in the bank's brand
// color — or a generic icon for freeform "Otro" banks not in the list —
// if there's no logo or it fails to load.
export function BankLogo({ bankName, size = 32, className }: { bankName: string; size?: number; className?: string }) {
  const [errored, setErrored] = useState(false);
  const bank = findBank(bankName);

  if (bank && !errored) {
    return (
      <div
        className={cn("rounded-lg bg-white flex items-center justify-center p-1 shrink-0 overflow-hidden", className)}
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://logo.clearbit.com/${bank.domain}?size=128`}
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
      className={cn("rounded-lg flex items-center justify-center font-bold text-white shrink-0", className)}
      style={{ width: size, height: size, backgroundColor: bank?.color || "#64748b", fontSize: size * 0.38 }}
    >
      {bank ? initials : <Landmark className="w-[55%] h-[55%]" />}
    </div>
  );
}
