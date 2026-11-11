"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, MoreVertical, Pencil, Trash2 } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import api from "@/lib/api";
import { formatARS, formatUSD, getErrorMessage } from "@/lib/utils";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { MotionList } from "@/components/ui/motion-list";
import { PrivacyMenuItem } from "@/components/ui/privacy-toggle";
import { LoadedByTag, useLoadedBy } from "@/components/LoadedBy";
import { LedgerRow } from "@/components/movimientos/Ledger";
import { EntrySheet, SheetActions, SheetRow } from "@/components/movimientos/EntrySheet";
import { CloseForm, EditInvestmentForm, MovementForm, RenewForm, type MovementMode } from "@/components/inversiones/forms";
import {
  MENU_ITEM, MENU_PANEL, TONE, isMarket, isStale, money, pctText, shortDate, signedMoney, statusLine, subLine, tnaText,
  type InvestmentDetail, type Movement,
} from "@/components/inversiones/shared";

/** Lo grande se lee primero; los centavos, si los hay, más chicos. */
function BigValue({ text, positive = false }: { text: string; positive?: boolean }) {
  const comma = text.lastIndexOf(",");
  return (
    <p className={`font-medium text-[clamp(2.5rem,12vw,3.25rem)] leading-[1.08] tracking-[-0.045em] tabular-nums ${positive ? "text-emerald-800" : "text-foreground"}`}>
      {comma >= 0 ? text.slice(0, comma) : text}
      {comma >= 0 && <span className="text-[0.5em] tracking-[-0.02em] text-muted-foreground">{text.slice(comma)}</span>}
    </p>
  );
}

const PRIMARY = "flex-1 h-[52px] rounded-full bg-ink text-background font-semibold text-[15.5px] active:scale-[0.98] transition-transform duration-100";
const SECONDARY = "flex-1 h-[52px] px-5 rounded-full border border-border bg-card font-semibold text-[15.5px] text-foreground active:scale-[0.98] transition-transform duration-100";
const SMALL = "min-h-[44px] px-4 rounded-full border border-border bg-card text-[14.5px] font-semibold text-foreground active:scale-[0.97] transition-transform duration-100";

const MOVEMENT_LABEL = { deposit: "Pusiste", withdrawal: "Sacaste", valuation: "Valor cargado" } as const;

type Sheet = MovementMode | "edit" | "renew" | "close" | null;

export default function InversionPage() {
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const reaccionar = useReaccion();
  const loadedBy = useLoadedBy();
  const [data, setData] = useState<InvestmentDetail | null>(null);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewing, setViewing] = useState<Movement | null>(null);
  const [sheetError, setSheetError] = useState("");
  const [reopenError, setReopenError] = useState("");

  const load = useCallback(() => {
    setError("");
    return api.get<InvestmentDetail>(`/investments/${id}`)
      .then(({ data }) => { setData(data); return data; })
      .catch(e => {
        if ((e as { response?: { status?: number } })?.response?.status === 404) setNotFound(true);
        else setError(getErrorMessage(e, "No pudimos traer esta inversión."));
        return null;
      });
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const back = (
    <Link href="/inversiones" className="inline-flex items-center gap-1.5 min-h-[44px] -ml-1 pr-2 text-[15px] font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft className="w-[18px] h-[18px]" /> Inversiones
    </Link>
  );

  if (notFound) {
    return (
      <div className="space-y-4">
        {back}
        <p className="px-2 text-[15.5px] text-muted-foreground">Esta inversión ya no existe. Puede que la hayan eliminado.</p>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="space-y-4">
        {back}
        <div role="alert" className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] text-rose-900">
          <p>{error} Fijate si tenés conexión.</p>
          <button onClick={load} className="mt-1 min-h-[40px] font-semibold underline">Probar de nuevo</button>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4" aria-busy="true">
        {back}
        <div className="px-2 animate-pulse space-y-3">
          <div className="h-8 w-48 rounded-full bg-ink/[0.07]" />
          <div className="h-14 w-60 rounded-2xl bg-ink/[0.07]" />
          <div className="h-5 w-40 rounded-full bg-ink/[0.07]" />
        </div>
        <span className="sr-only">Cargando la inversión</span>
      </div>
    );
  }

  const { investment: inv, movements } = data;
  const closed = !!inv.closed_at;
  const market = isMarket(inv.kind);
  // Rescatada, lo dice la caja de abajo.
  const status = closed ? null : statusLine(inv);
  const sub = subLine(inv);
  const fmt = inv.currency === "USD" ? formatUSD : formatARS;
  const gain = Number(inv.gain);
  const pct = pctText(inv.gain_pct);
  const deposits = movements.filter(m => m.kind === "deposit").reduce((s, m) => s + Number(m.amount), 0);
  const withdrawals = movements.filter(m => m.kind === "withdrawal").reduce((s, m) => s + Number(m.amount), 0);
  // La lista, lo más nuevo arriba.
  const list = [...movements].sort((a, b) => b.movement_date.localeCompare(a.movement_date) || b.id - a.id);

  async function deleteInvestment() {
    try {
      await api.delete(`/investments/${inv.id}`);
      reaccionar("borrado", "Inversión eliminada");
      router.push("/inversiones");
    } catch (e) {
      setConfirmDelete(false);
      reaccionar("error", getErrorMessage(e, "No se pudo eliminar"));
    }
  }

  async function deleteMovement(m: Movement) {
    setSheetError("");
    try {
      await api.delete(`/investments/movements/${m.id}`);
      setViewing(null);
      reaccionar("borrado", m.kind === "valuation" ? "Valor eliminado" : "Movimiento eliminado");
      load();
    } catch (e) {
      setSheetError(getErrorMessage(e, "No se pudo eliminar."));
    }
  }

  async function reopen() {
    setReopenError("");
    try {
      await api.delete(`/investments/${inv.id}/close`);
      reaccionar("guardado", "Volvió a estar vigente");
      load();
    } catch (e) {
      setReopenError(getErrorMessage(e, "No se pudo deshacer el rescate."));
    }
  }

  const done = (text: string) => { setSheet(null); reaccionar("guardado", text); load(); };

  // Sólo lo que la línea de estado no dice ya.
  const facts: { label: string; value: string }[] = [];
  if (!closed && inv.tna && !(inv.calculated && !inv.matured)) facts.push({ label: "TNA", value: tnaText(inv.tna) });
  facts.push({ label: inv.kind === "plazo_fijo" ? "Lo hiciste el" : "Desde", value: shortDate(inv.start_date) });
  if (closed && withdrawals > 0) facts.push({ label: "Sacaste en total", value: money(withdrawals, inv.currency) });

  // Qué se viene a hacer, según el tipo y el momento.
  let primary: React.ReactNode = null;
  const extra: { label: string; onClick: () => void }[] = [];
  if (!closed) {
    if (inv.matured) {
      primary = <>
        <button onClick={() => setSheet("renew")} className={PRIMARY}>Renovar</button>
        <button onClick={() => setSheet("close")} className={SECONDARY}>Rescatar</button>
      </>;
    } else if (market) {
      primary = <button onClick={() => setSheet("valuation")} className={PRIMARY}>Actualizar valor</button>;
      extra.push({ label: "Poner más", onClick: () => setSheet("deposit") }, { label: "Sacar", onClick: () => setSheet("withdrawal") }, { label: "Rescatar", onClick: () => setSheet("close") });
    } else if (inv.kind === "plazo_fijo") {
      // En un plazo fijo no se pone ni se saca: corre hasta el vencimiento, y
      // ahí se renueva (con más o menos plata) o se rescata.
      extra.push({ label: "Rescatar antes", onClick: () => setSheet("close") });
      if (inv.calculated) extra.push({ label: "Cargar el valor del banco", onClick: () => setSheet("valuation") });
    } else {
      primary = <>
        <button onClick={() => setSheet("deposit")} className={PRIMARY}>Poner más</button>
        <button onClick={() => setSheet("withdrawal")} className={SECONDARY}>Sacar</button>
      </>;
      extra.push({ label: "Rescatar", onClick: () => setSheet("close") });
      if (inv.calculated) extra.push({ label: "Cargar el valor del banco", onClick: () => setSheet("valuation") });
    }
  }

  return (
    <div className="space-y-4 md:space-y-6 md:pb-16">
      <div className="flex items-center justify-between gap-2">
        {back}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button title="Más acciones" aria-label="Más acciones"
              className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors outline-none">
              <MoreVertical className="w-5 h-5" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} className={MENU_PANEL}>
              <DropdownMenu.Item asChild>
                <button onClick={() => setSheet("edit")} className={`${MENU_ITEM} text-foreground`}>
                  <Pencil className="w-4 h-4 text-muted-foreground" /> Editar
                </button>
              </DropdownMenu.Item>
              <DropdownMenu.Item asChild><PrivacyMenuItem /></DropdownMenu.Item>
              <DropdownMenu.Separator className="h-px bg-border my-1" />
              <DropdownMenu.Item asChild>
                <button onClick={() => setConfirmDelete(true)} className={`${MENU_ITEM} text-destructive`}>
                  <Trash2 className="w-4 h-4" /> Eliminar
                </button>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <MotionList className="space-y-4">
        {confirmDelete && (
          <div className="rounded-[22px] bg-rose-50 border border-rose-200 p-2.5" role="alert">
            <p className="px-1.5 pb-2 text-[15px] font-medium text-rose-900">
              ¿Eliminar {inv.name} y {movements.length === 1 ? "su movimiento" : `sus ${movements.length} movimientos`}? No se puede deshacer.
              {!closed && " Si ya sacaste la plata, mejor rescatala: queda lo que ganaste."}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" autoFocus onClick={() => setConfirmDelete(false)}
                className="h-12 rounded-full bg-white border border-rose-200 font-semibold text-[15px] text-foreground">
                No, dejarla
              </button>
              <button type="button" onClick={deleteInvestment}
                className="h-12 rounded-full bg-destructive text-destructive-foreground font-semibold text-[15px]">
                Sí, eliminar
              </button>
            </div>
          </div>
        )}

        <div className="lg:grid lg:grid-cols-2 lg:gap-10 lg:items-start space-y-4 lg:space-y-0">
          <section className="px-2">
            <h1 className="text-[26px] md:text-3xl font-display font-medium leading-tight tracking-[-0.035em] text-foreground break-words">{inv.name}</h1>
            {sub && <p className="mt-0.5 text-[15px] text-muted-foreground">{sub}</p>}

            <div className="mt-3">
              {closed ? <>
                <p className="text-[15.5px] text-muted-foreground">{gain >= 0 ? "Ganaste" : "Perdiste"}</p>
                <BigValue text={money(Math.abs(gain), inv.currency)} positive={gain > 0} />
                <p className="mt-0.5 text-[15.5px] text-muted-foreground tabular-nums">
                  Pusiste {money(deposits, inv.currency)}{pct && ` · ${pct}`}
                </p>
              </> : <>
                <p className="text-[15.5px] text-muted-foreground">Vale hoy</p>
                <BigValue text={money(inv.value, inv.currency)} />
                <p className="mt-0.5 text-[15.5px] text-muted-foreground tabular-nums">
                  {/* Con salidas, "puesto − sacado" no es lo que la persona puso: se dicen las dos cosas. */}
                  {withdrawals > 0
                    ? <>Pusiste {money(deposits, inv.currency)} · sacaste {money(withdrawals, inv.currency)}</>
                    : <>Pusiste {money(inv.invested, inv.currency)}</>}
                  {signedMoney(gain, inv.currency) && <>
                    {" · "}
                    <span className={gain > 0 ? "text-emerald-800" : "text-foreground"}>{signedMoney(gain, inv.currency)}{pct && ` (${pct})`}</span>
                  </>}
                </p>
              </>}
            </div>
            {status && (
              <p className={`mt-2 flex items-center gap-1.5 text-[15.5px] font-medium ${TONE[status.tone]}`}>
                {status.tone === "pending" && <span aria-hidden="true" className="w-1.5 h-1.5 shrink-0 rounded-full bg-amber-500" />}
                {status.text}
              </p>
            )}
            {inv.calculated && !closed && !inv.matured && inv.kind === "plazo_fijo" && inv.tna && (
              <p className="mt-0.5 text-sm text-muted-foreground">Calculado con la TNA del {tnaText(inv.tna)}, día por día.</p>
            )}
            {inv.matured && (
              <p className="mt-1 text-sm leading-snug text-muted-foreground">Desde que venció no rinde: si lo renovaste, cargá el plazo nuevo; si lo sacaste, rescatalo.</p>
            )}
            {market && isStale(inv) && (
              <p className="mt-1 text-sm leading-snug text-muted-foreground">Con un valor viejo, lo que ves acá puede estar lejos de lo que vale.</p>
            )}

            {closed ? (
              <div className="mt-4 rounded-3xl p-4 bg-accent border border-[#CFC9E4]">
                <p className="text-[15px] leading-snug text-[#4A4658]">La rescataste el {shortDate(inv.closed_at!)}. Ya no suma en lo que vale hoy.</p>
                {reopenError && <p role="alert" className="mt-2 text-sm text-destructive">{reopenError}</p>}
                <button onClick={reopen}
                  className="mt-3 h-11 px-5 rounded-full bg-ink text-background text-sm font-semibold active:scale-[0.97] transition-transform duration-100">
                  Deshacer el rescate
                </button>
              </div>
            ) : (
              <>
                <div className="mt-4 flex items-center gap-2">{primary}</div>
                {extra.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {extra.map(a => <button key={a.label} onClick={a.onClick} className={SMALL}>{a.label}</button>)}
                  </div>
                )}
              </>
            )}

            <div className="mt-4 rounded-[22px] bg-card border border-border px-4 divide-y divide-border">
              {facts.map(f => (
                <div key={f.label} className="flex items-baseline justify-between gap-4 py-2.5 text-[15px]">
                  <span className="text-[#4A4658]">{f.label}</span>
                  <span className="font-medium text-foreground tabular-nums text-right">{f.value}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="px-2">
            <h2 className="mb-1 text-[22px] font-medium tracking-[-0.03em] text-foreground">Movimientos</h2>
            <MotionList>
              {list.map((m, i) => {
                const who = loadedBy.nameOf(m.user_id);
                const isVal = m.kind === "valuation";
                const label = MOVEMENT_LABEL[m.kind];
                return (
                  <LedgerRow key={m.id}
                    date={m.movement_date}
                    showDate={i === 0 || list[i - 1].movement_date !== m.movement_date}
                    title={isVal ? `Valía ${money(m.amount, inv.currency)}` : (m.note || label)}
                    sub={m.note || who ? <>
                      {m.note && <span className="block truncate">{isVal ? m.note : label}</span>}
                      <LoadedByTag name={who} />
                    </> : undefined}
                    amount={isVal ? "" : `${m.kind === "withdrawal" ? "−" : "+"}${money(m.amount, inv.currency)}`}
                    positive={m.kind === "deposit"}
                    onOpen={() => { setSheetError(""); setViewing(m); }}
                  />
                );
              })}
            </MotionList>
          </section>
        </div>
      </MotionList>

      {viewing && (
        <EntrySheet
          date={viewing.movement_date}
          title={viewing.kind === "valuation" ? "Lo que valía ese día" : (viewing.note || MOVEMENT_LABEL[viewing.kind])}
          badge={viewing.note && viewing.kind !== "valuation" ? { label: MOVEMENT_LABEL[viewing.kind] } : undefined}
          amount={`${viewing.kind === "withdrawal" ? "−" : ""}${fmt(viewing.amount)}`}
          positive={viewing.kind === "deposit"}
          onClose={() => setViewing(null)}
          footer={<>
            {sheetError && <p role="alert" className="px-1.5 pb-2.5 text-sm leading-snug text-destructive">{sheetError}</p>}
            <SheetActions
              question={viewing.kind === "valuation" ? "¿Eliminar este valor? Vuelve a contar el anterior." : undefined}
              noun="movimiento"
              onDelete={() => deleteMovement(viewing)} />
          </>}
        >
          {viewing.kind === "valuation" && viewing.note && <SheetRow label="Nota">{viewing.note}</SheetRow>}
          {loadedBy.nameOf(viewing.user_id) && <SheetRow label="Lo cargó">{loadedBy.nameOf(viewing.user_id)}</SheetRow>}
        </EntrySheet>
      )}

      {(sheet === "deposit" || sheet === "withdrawal" || sheet === "valuation") && (
        <MovementForm inv={inv} mode={sheet} onClose={() => setSheet(null)}
          onSaved={() => done(sheet === "valuation" ? "Valor actualizado" : sheet === "deposit" ? "Guardado" : "Salida guardada")} />
      )}
      {sheet === "edit" && <EditInvestmentForm inv={inv} onClose={() => setSheet(null)} onSaved={() => done("Inversión actualizada")} />}
      {sheet === "renew" && <RenewForm inv={inv} onClose={() => setSheet(null)} onSaved={() => done("Plazo fijo renovado")} />}
      {sheet === "close" && (
        <CloseForm inv={inv} onClose={() => setSheet(null)}
          onSaved={g => {
            setSheet(null);
            if (g > 0.005) reaccionar("ingreso", `Rescatada: ganaste ${money(g, inv.currency)}`);
            else reaccionar("guardado", "Rescatada");
            load();
          }} />
      )}
    </div>
  );
}
