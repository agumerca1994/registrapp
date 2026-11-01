"use client";

import { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { FIELD } from "@/components/ui/form";
import { cn, formatARS, parseAmount } from "@/lib/utils";

// Las dos calculadoras de /negocio/calculadora. Todo vive en el estado del componente: nada se manda ni se guarda.

/** Pesos sin centavos: en una cuenta de margen los centavos sólo agregan ruido. */
const money = (n: number) => formatARS(Math.round(n)).replace(/,00$/, "");
const pct = (n: number) =>
  `${n.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;
/** Al salir del campo, el número queda con sus puntos de miles ("2000000" → "2.000.000"). */
const tidy = (raw: string) => {
  if (!raw.trim()) return raw;
  const n = parseAmount(raw);
  return Number.isFinite(n) ? n.toLocaleString("es-AR", { maximumFractionDigits: 2 }) : raw;
};

function AmountInput({ id, value, onChange, label, className }: {
  id?: string; value: string; onChange: (v: string) => void; label?: string; className?: string;
}) {
  return (
    <input id={id} type="text" inputMode="decimal" pattern="[0-9.,]*" autoComplete="off"
      aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
      onBlur={() => onChange(tidy(value))}
      className={cn(FIELD, "text-base tabular-nums text-right", className)} />
  );
}

function Panel({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border-2 border-ink bg-card p-5 md:p-6 shadow-chip">
      <h2 className="font-display font-bold text-2xl tracking-tight">{title}</h2>
      <p className="mt-1 text-muted-foreground">{intro}</p>
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

type Row = { id: number; name: string; amount: string };
const EXAMPLE: Row[] = [
  { id: 1, name: "Mercadería", amount: "700.000" },
  { id: 2, name: "Alquiler", amount: "450.000" },
  { id: 3, name: "Sueldos", amount: "380.000" },
  { id: 4, name: "Luz y gas", amount: "68.000" },
];

export function ProfitCalculator() {
  const uid = useId();
  const [sales, setSales] = useState("2.000.000");
  const [rows, setRows] = useState<Row[]>(EXAMPLE);
  const [nextId, setNextId] = useState(EXAMPLE.length + 1);

  const salesN = parseAmount(sales);
  const costs = rows.reduce((acc, r) => acc + parseAmount(r.amount), 0);
  const result = salesN - costs;
  const margin = salesN > 0 ? (result / salesN) * 100 : null;
  const update = (id: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <Panel title="¿Cuánto ganaste?" intro="Lo que vendiste en el mes menos lo que gastaste.">
      <div>
        <label htmlFor={`${uid}-sales`} className="text-sm font-semibold">Ventas del mes</label>
        <AmountInput id={`${uid}-sales`} value={sales} onChange={setSales} />
      </div>

      <fieldset className="min-w-0">
        <legend className="text-sm font-semibold">Gastos del mes</legend>
        <ul className="mt-1 space-y-2">
          {rows.map((r, i) => (
            <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)_2.5rem] gap-2 items-center">
              <input type="text" value={r.name} placeholder="Otro gasto" aria-label={`Gasto ${i + 1}: nombre`}
                onChange={(e) => update(r.id, { name: e.target.value })}
                className={cn(FIELD, "mt-0 text-base")} />
              <AmountInput value={r.amount} label={`Gasto ${i + 1}: monto`}
                onChange={(v) => update(r.id, { amount: v })} className="mt-0" />
              <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                aria-label={`Quitar ${r.name || `gasto ${i + 1}`}`}
                className="h-10 w-10 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted">
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <button type="button"
          onClick={() => { setRows((rs) => [...rs, { id: nextId, name: "", amount: "" }]); setNextId((n) => n + 1); }}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-white px-4 py-2 text-sm font-semibold shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
          <Plus className="w-4 h-4" aria-hidden="true" /> Agregar gasto
        </button>
        <p className="mt-3 text-sm text-muted-foreground">
          Total de gastos: <span className="tabular-nums font-medium text-foreground">{money(costs)}</span>
        </p>
      </fieldset>

      <div aria-live="polite" className="rounded-xl bg-primary/10 border border-primary/30 p-4 grid grid-cols-2 gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Te quedó</p>
          <p className={cn("font-display font-bold text-2xl sm:text-3xl tabular-nums break-words", result < 0 && "text-red-600")}>
            {money(result)}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Margen neto</p>
          <p className={cn("font-display font-bold text-2xl sm:text-3xl tabular-nums", margin !== null && margin < 0 && "text-red-600")}>
            {margin === null ? "—" : pct(margin)}
          </p>
        </div>
        <p className="col-span-2 text-sm text-muted-foreground">
          {margin === null
            ? "Poné las ventas del mes para ver el margen."
            : result < 0
              ? "Gastaste más de lo que vendiste: este mes el negocio perdió plata."
              : `De cada $100 que vendiste, te quedaron $${Math.round(margin)}.`}
        </p>
      </div>
    </Panel>
  );
}

export function PriceCalculator() {
  const uid = useId();
  const [cost, setCost] = useState("10.000");
  const [marginIn, setMarginIn] = useState("30");

  const costN = parseAmount(cost);
  const m = parseAmount(marginIn) / 100;
  const valid = costN > 0 && m >= 0 && m < 1;
  const price = valid ? costN / (1 - m) : null;
  const wrong = costN > 0 && m >= 0 ? costN * (1 + m) : null;
  const wrongMargin = wrong ? ((wrong - costN) / wrong) * 100 : null;

  return (
    <Panel title="¿A cuánto lo vendo?" intro="El precio para ganar el margen que querés sobre lo que cobrás.">
      <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
        <div>
          <label htmlFor={`${uid}-cost`} className="text-sm font-semibold">Costo del producto</label>
          <AmountInput id={`${uid}-cost`} value={cost} onChange={setCost} />
        </div>
        <div>
          <label htmlFor={`${uid}-margin`} className="text-sm font-semibold">Margen que querés</label>
          <div className="relative">
            <input id={`${uid}-margin`} type="text" inputMode="decimal" pattern="[0-9.,]*" autoComplete="off"
              value={marginIn} onChange={(e) => setMarginIn(e.target.value)} aria-describedby={`${uid}-margin-unit`}
              className={cn(FIELD, "text-base tabular-nums text-right pr-8")} />
            <span id={`${uid}-margin-unit`} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 mt-0.5 text-base text-muted-foreground">
              %<span className="sr-only"> sobre el precio de venta</span>
            </span>
          </div>
        </div>
      </div>

      <div aria-live="polite" className="rounded-xl bg-primary/10 border border-primary/30 p-4">
        <p className="text-sm text-muted-foreground">Vendelo a</p>
        <p className="font-display font-bold text-3xl tabular-nums">{price === null ? "—" : money(price)}</p>
        {price !== null ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Así, de cada venta te quedan {money(price - costN)}: el {pct(m * 100)} de lo que cobrás.
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            {m >= 1 ? "El margen tiene que ser menor a 100%." : "Poné el costo y el margen."}
          </p>
        )}
      </div>

      {price !== null && wrong !== null && wrongMargin !== null && m > 0 && (
        <div className="rounded-xl border-2 border-dashed border-border p-4">
          <p className="text-sm font-semibold">El error más común</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Sumarle el {pct(m * 100)} al costo: {money(costN)} + {pct(m * 100)} ={" "}
            <span className="font-semibold text-foreground tabular-nums">{money(wrong)}</span>.
            Pero así ganás {money(wrong - costN)} sobre {money(wrong)}, que es un{" "}
            <span className="font-semibold text-red-600">{pct(wrongMargin)}</span>, no un {pct(m * 100)}.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            El margen se cuenta sobre el precio que cobrás, no sobre el costo. Por eso hay que dividir, no sumar.
          </p>
        </div>
      )}
    </Panel>
  );
}
