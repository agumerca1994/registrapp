"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PiggyBank } from "lucide-react";
import api from "@/lib/api";
import { formatARSRound } from "@/lib/utils";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { Card } from "@/components/ui/card";
import { ProgressBar, money, monthLabel, type Goal, type GoalsResponse } from "@/components/ahorro/goals";

const BUTTON = "inline-flex items-center justify-center h-11 px-5 rounded-full bg-ink text-background text-[14.5px] font-semibold active:scale-[0.97] transition-transform duration-100";

/** El objetivo que más empuja: el de fecha más cercana, y sin fecha el más avanzado. */
function focusGoal(goals: Goal[]): Goal {
  return [...goals].sort((a, b) => {
    if (a.target_date && b.target_date) return a.target_date.localeCompare(b.target_date);
    if (a.target_date || b.target_date) return a.target_date ? -1 : 1;
    return b.pct - a.pct;
  })[0];
}

/** Lo que hay que hacer este mes con ese objetivo, dicho como empujón y no como deuda. */
function nudge(g: Goal, today: string): string {
  const thisMonth = !!g.last_contribution && g.last_contribution.slice(0, 7) === today.slice(0, 7);
  if (g.overdue) return `Se pasó la fecha y te faltan ${money(g.remaining, g.currency)}. Podés moverla o seguir sumando.`;
  if (thisMonth) return "Este mes ya aportaste. Vas bien.";
  if (g.pct >= 75) return `Te falta poco: ${money(g.remaining, g.currency)}.`;
  if (g.per_month_needed !== null && g.target_date) {
    return `Este mes te toca apartar ${money(g.per_month_needed, g.currency)} para llegar a ${monthLabel(g.target_date)}.`;
  }
  return `Te faltan ${money(g.remaining, g.currency)}. Cada aporte suma.`;
}

/**
 * Ahorro en Inicio, como incentivo. Con objetivos, el más cercano y lo que toca
 * este mes. Sin objetivos, sólo si el mes viene con plata a favor: invitar a
 * apartar cuando no sobra nada sería un reto, no un empujón. Si el pedido falla,
 * no muestra nada: Inicio no depende de esto.
 */
export function GoalsNudge({ today, leftToSpend, hasIncome }: { today: string; leftToSpend: number; hasIncome: boolean }) {
  useAmountsHidden();
  const [data, setData] = useState<GoalsResponse | null>(null);

  useEffect(() => {
    api.get<GoalsResponse>("/savings/goals").then(({ data }) => setData(data)).catch(() => {});
  }, []);

  if (!data) return null;
  const visible = data.goals.filter(g => !g.archived);
  const open = visible.filter(g => !g.achieved);

  if (open.length > 0) {
    const g = focusGoal(open);
    const others = open.length - 1;
    return (
      <Card className="p-[18px]">
        <div className="flex items-center gap-2">
          <PiggyBank className="w-4 h-4 text-[#3B2FB3]" aria-hidden="true" />
          <h2 className="text-[15px] font-medium text-muted-foreground">Tu objetivo</h2>
          {others > 0 && (
            <Link href="/ahorro" className="ml-auto text-sm font-medium text-[#3B2FB3] min-h-[36px] inline-flex items-center">
              y {others} más
            </Link>
          )}
        </div>
        <p className="mt-1 text-[22px] font-medium leading-tight tracking-[-0.03em] truncate">{g.name}</p>
        <p className="mt-0.5 text-[15px] tabular-nums">
          {Number(g.saved) > 0
            ? <><span className="font-semibold">{money(g.saved, g.currency)}</span> <span className="text-muted-foreground">de {money(g.target_amount, g.currency)}</span></>
            : <span className="text-muted-foreground">Meta {money(g.target_amount, g.currency)}</span>}
        </p>
        <ProgressBar pct={g.pct} className="mt-2.5" />
        <p className="mt-2.5 text-[15px] leading-snug text-[#3B2FB3]">{nudge(g, today)}</p>
        <Link href={`/ahorro/${g.id}?aportar=1`} className={`mt-3.5 ${BUTTON}`}>Aportar</Link>
      </Card>
    );
  }

  // Todos cumplidos: festejarlo es el mejor motivo para el siguiente.
  if (visible.length > 0) {
    return (
      <Card className="p-[18px]">
        <p className="text-[22px] font-medium leading-tight tracking-[-0.03em]">
          {visible.length === 1 ? `Cumpliste «${visible[0].name}».` : `Cumpliste tus ${visible.length} objetivos.`}
        </p>
        <p className="mt-1 text-[15px] leading-snug text-muted-foreground">¿Vamos por el próximo?</p>
        <Link href="/ahorro?nuevo=1" className={`mt-3.5 ${BUTTON}`}>Nuevo objetivo</Link>
      </Card>
    );
  }

  if (!hasIncome || leftToSpend <= 0) return null;
  return (
    <Card className="p-[18px]">
      <div className="flex items-center gap-2">
        <PiggyBank className="w-4 h-4 text-[#3B2FB3]" aria-hidden="true" />
        <h2 className="text-[15px] font-medium text-muted-foreground">Ahorro</h2>
      </div>
      <p className="mt-1 text-[22px] font-medium leading-tight tracking-[-0.03em]">¿Apartás una parte?</p>
      <p className="mt-1 text-[15px] leading-snug text-muted-foreground">
        Este mes te quedan {formatARSRound(leftToSpend)}. Ponele nombre y fecha a algo que quieras, y te digo cuánto separar cada mes.
      </p>
      <Link href="/ahorro?nuevo=1" className={`mt-3.5 ${BUTTON}`}>Crear un objetivo</Link>
    </Card>
  );
}
