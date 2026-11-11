"use client";

import Link from "next/link";
import { formatARSRound } from "@/lib/utils";
import { GLASS } from "@/components/ui/glass";
import type { DaySummary } from "@/lib/sales";

/**
 * El cierre del día, en el bloque violeta de Inicio y de Ventas. La diferencia
 * con las ventas sólo se muestra: lo que se guarda es lo contado
 * (services/business/sales.py).
 */
export function ClosePanel({ summary, href, onClick, ...rest }: {
  summary: DaySummary;
  /** Inicio lleva a Ventas; en Ventas abre el formulario. */
  href?: string;
  onClick?: () => void;
} & React.HTMLAttributes<HTMLDivElement>) {
  const closed = !!summary.close;
  const hasTickets = summary.tickets.length > 0;
  const diff = Math.round((Number(summary.counted_total ?? 0) - Number(summary.ticketed_total)) * 100) / 100;
  const text = !closed
    ? hasTickets ? "Al terminar, contá la caja. Se precarga con las ventas." : "¿No cargás venta por venta? Cerralo con lo que hay en la caja."
    : !hasTickets ? "Sin ventas cargadas: el día suma lo contado."
    : diff > 0 ? `${formatARSRound(diff)} sin ticket.`
    : diff < 0 ? `Falta ${formatARSRound(-diff)} contra las ventas.`
    : "Coincide con las ventas.";
  const label = closed ? "Editar cierre" : "Cerrar el día";
  const button = "shrink-0 inline-flex items-center justify-center h-11 px-4 rounded-full bg-white text-[#2A2178] font-semibold text-[14.5px] whitespace-nowrap active:scale-[0.97] transition-transform duration-100";
  return (
    <div {...rest} className={`${GLASS} flex items-center gap-3 pl-4 pr-2.5 py-2.5`}>
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-medium leading-tight tracking-[-0.02em]">{closed ? "Cerrado" : "Sin cerrar"}</p>
        <p className="mt-0.5 text-[13.5px] leading-snug text-white/90">{text}</p>
      </div>
      {href
        ? <Link href={href} className={button}>{label}</Link>
        : <button type="button" onClick={onClick} className={button}>{label}</button>}
    </div>
  );
}
