import { Card } from "@/components/ui/card";
import { formatARS, formatPct, formatUSD } from "@/lib/utils";

export interface BreakdownRow {
  key: string;
  label: string;
  color?: string | null;
  total: number;        // ARS
  total_usd: number;    // USD, aparte: nunca se suman
  // Para ordenar y dimensionar la barra, nada más: los montos no se mezclan.
  ars_equivalent: number;
}

/**
 * Una lista de barras "cuánto se fue en cada cosa": egresos por categoría en
 * el dashboard del hogar, y también por proveedor/empleado en el del negocio.
 *
 * Las barras se dimensionan por el equivalente en pesos, así una fila pagada
 * en dólares se compara con una en pesos — pero los montos quedan separados,
 * para que se vea qué se pagó en qué.
 */
export function BreakdownBarsCard({ title, rows, footnote }: {
  title: string;
  rows: BreakdownRow[];
  footnote?: string | null;
}) {
  const total = rows.reduce((s, r) => s + Number(r.ars_equivalent), 0);
  return (
    <Card className="p-4 md:p-5">
      <h3 className="font-semibold text-foreground mb-3 text-sm md:text-base">{title}</h3>
      <div className="space-y-2.5">
        {rows.map((row, i) => {
          const share = total > 0 ? (row.ars_equivalent / total) * 100 : 0;
          return (
            <div key={row.key}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: row.color || "#6366f1" }} />
                  <span className="text-sm text-foreground truncate">{row.label}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <span className="text-sm font-medium">
                    {row.total > 0 && formatARS(row.total)}
                    {row.total > 0 && row.total_usd > 0 && " + "}
                    {row.total_usd > 0 && (
                      <span className="text-emerald-600">{formatUSD(row.total_usd)}</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">({formatPct(share)})</span>
                </div>
              </div>
              <div className="h-1 bg-muted rounded-full overflow-hidden">
                {/* Staggered by row so the list fills top to bottom
                    instead of every bar snapping at once. */}
                <div className="h-full rounded-full animate-grow-bar"
                  style={{
                    width: `${share}%`,
                    backgroundColor: row.color || "#6366f1",
                    animationDelay: `${i * 80}ms`,
                  }} />
              </div>
            </div>
          );
        })}
      </div>
      {footnote && (
        <p className="text-[11px] text-muted-foreground mt-3 pt-2.5 border-t">{footnote}</p>
      )}
    </Card>
  );
}
