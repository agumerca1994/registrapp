"use client";

import { X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ScrollRow } from "@/components/ui/scroll-row";
import { formatARSRound, formatUSD } from "@/lib/utils";
import type { BreakdownRow } from "@/components/dashboard/BreakdownBarsCard";

/**
 * "¿En qué se fue la plata?" con altura fija: una barra con las proporciones y
 * las categorías en una fila que se desliza. Una lista de barras crecía con cada
 * categoría y mandaba la tabla fuera de la pantalla.
 *
 * Tocar una categoría filtra la tabla de abajo y tocarla de nuevo la suelta. No
 * baja hasta la tabla a propósito: así se pasa de una categoría a otra sin volver.
 */
export function BreakdownStrip({ title, rows, picked, onPick, footnote }: {
  title: string;
  rows: BreakdownRow[];
  picked: string | null;
  onPick: (key: string | null) => void;
  footnote?: string | null;
}) {
  const total = rows.reduce((s, r) => s + Number(r.ars_equivalent), 0);
  return (
    <Card className="px-0 py-3.5 md:px-0 md:py-4">
      <h3 className="px-4 md:px-5 font-semibold text-foreground text-sm md:text-base">{title}</h3>
      {/* El detalle de la barra está en las categorías: acá es sólo la proporción. */}
      <div aria-hidden="true" className="mx-4 md:mx-5 mt-2.5 mb-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
        {rows.map(row => (
          <span key={row.key}
            className={`h-full min-w-[3px] animate-grow-bar transition-opacity ${picked && picked !== row.key ? "opacity-25" : ""}`}
            style={{ flexGrow: total > 0 ? row.ars_equivalent / total : 0, flexBasis: 0, backgroundColor: row.color || "#6366f1" }} />
        ))}
      </div>
      <ScrollRow gap="gap-2" className="px-4 md:px-5">
        {rows.map(row => {
          const active = picked === row.key;
          return (
            <button key={row.key} type="button" aria-pressed={active}
              onClick={() => onPick(active ? null : row.key)}
              className={`shrink-0 min-h-[52px] rounded-2xl border px-3 py-1.5 text-left transition-colors ${
                active ? "border-transparent bg-accent" : "border-border bg-background/60 hover:bg-accent/50"
              }`}>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: row.color || "#6366f1" }} />
                <span className={active ? "font-semibold text-foreground" : ""}>{row.label}</span>
                {active && <X className="w-3 h-3 text-foreground" aria-hidden="true" />}
              </span>
              <span className="block mt-0.5 text-sm font-semibold tabular-nums text-foreground whitespace-nowrap">
                {row.total > 0 && formatARSRound(row.total)}
                {row.total > 0 && row.total_usd > 0 && " + "}
                {row.total_usd > 0 && formatUSD(row.total_usd)}
              </span>
            </button>
          );
        })}
      </ScrollRow>
      {footnote && <p className="px-4 md:px-5 mt-2.5 text-[11px] text-muted-foreground">{footnote}</p>}
    </Card>
  );
}
