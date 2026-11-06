"use client";

import { useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import api from "@/lib/api";
import { getErrorMessage, parseAmount } from "@/lib/utils";
import { Chip } from "@/components/ui/chip";
import { DateField, FIELD, SegmentedToggle } from "@/components/ui/form";
import { MotionList } from "@/components/ui/motion-list";
import { AmountField, FORM_SHEET_BODY, FORM_SHEET_FORM, FormSheet, FormSheetActions } from "@/components/movimientos/FormSheet";
import {
  KIND_OPTIONS, LABEL, OPTION, ago, amountText, isMarket, money, shortDate, simpleAtMaturity, tnaText,
  type Currency, type Investment, type Kind,
} from "@/components/inversiones/shared";

const STEP = "flex-1 min-h-0 flex flex-col";
const today = () => format(new Date(), "yyyy-MM-dd");
const NOTE = "rounded-[22px] bg-accent border border-[#CFC9E4] px-4 py-3 text-[15px] leading-snug text-foreground";
const SHORTCUT = "min-h-[40px] px-3.5 rounded-full border text-[14px] font-medium active:scale-[0.97] transition-transform duration-100";

/** Dónde está la plata, según el tipo: lo que la persona diría. */
const INSTITUTION_LABEL: Record<Kind, { label: string; placeholder: string }> = {
  plazo_fijo: { label: "Banco", placeholder: "Nación, Galicia, Mercado Pago…" },
  cuenta: { label: "Banco o billetera", placeholder: "Mercado Pago, Ualá, Brubank…" },
  fci: { label: "Dónde lo tenés", placeholder: "El banco, el broker…" },
  acciones: { label: "Broker", placeholder: "IOL, Balanz, Cocos…" },
  cripto: { label: "Dónde la tenés", placeholder: "Binance, Lemon, una billetera propia…" },
  efectivo: { label: "Dónde está", placeholder: "En casa, en la caja de seguridad…" },
};

function suggestedName(kind: Kind, currency: Currency, institution: string): string {
  // El efectivo se nombra por la moneda: "Dólares en casa".
  const base = kind === "efectivo" ? (currency === "USD" ? "Dólares" : "Pesos") : KIND_OPTIONS.find(k => k.kind === kind)?.short ?? "";
  const inst = institution.trim();
  if (!inst) return base;
  return `${base} ${kind === "efectivo" ? inst.charAt(0).toLowerCase() + inst.slice(1) : inst}`;
}

/** 30, 60 o 90 días desde una fecha: los plazos que ofrece cualquier banco. */
function MaturityShortcuts({ from, value, onPick }: { from: string; value: string; onPick: (iso: string) => void }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {[30, 60, 90].map(n => {
        const iso = format(addDays(parseISO(from), n), "yyyy-MM-dd");
        const on = iso === value;
        return (
          <button key={n} type="button" onClick={() => onPick(iso)} aria-pressed={on}
            className={`${SHORTCUT} ${on ? "bg-ink text-background border-ink" : "bg-white/70 border-[#CFC9E4] text-foreground"}`}>
            {n} días
          </button>
        );
      })}
    </div>
  );
}

function TnaField({ id, value, onChange, hint }: { id: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div>
      <label htmlFor={id} className={LABEL}>TNA {hint && <span className="font-normal">({hint})</span>}</label>
      <div className="relative">
        <input id={id} className={`${FIELD} tabular-nums pr-10`} type="text" inputMode="decimal" pattern="[0-9.,]*"
          placeholder="32" value={value} onChange={e => onChange(e.target.value)} />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
      </div>
    </div>
  );
}

/**
 * Nueva inversión: primero qué es, después lo mínimo para saber cuánto vale.
 * `first` es la primera de la cuenta: ahí se dice, una vez, que esto no es un gasto.
 */
export function InvestmentForm({ initialKind, first, onSaved, onClose }: {
  initialKind?: Kind;
  first: boolean;
  onSaved: (inv: Investment) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<Kind | null>(initialKind ?? null);
  const [currency, setCurrency] = useState<Currency>(initialKind === "cripto" ? "USD" : "ARS");
  const [amount, setAmount] = useState("");
  const [institution, setInstitution] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [tna, setTna] = useState("");
  const [start, setStart] = useState(today());
  const [maturity, setMaturity] = useState(() => format(addDays(new Date(), 30), "yyyy-MM-dd"));
  const [maturityTouched, setMaturityTouched] = useState(false);
  const [current, setCurrent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function pick(k: Kind) {
    setKind(k);
    setCurrency(k === "cripto" ? "USD" : "ARS");
    setError("");
  }

  if (!kind) {
    return (
      <FormSheet title="¿Qué inversión es?" onClose={onClose}>
        <MotionList className={STEP}>
          <div className="flex-1 min-h-0 overflow-y-auto px-3.5 pb-3.5 space-y-2">
            {KIND_OPTIONS.map(k => (
              <button key={k.kind} type="button" className={OPTION} onClick={() => pick(k.kind)}>
                <span className="block text-[15.5px] font-semibold text-foreground">{k.label}</span>
                <span className="block mt-0.5 text-sm leading-snug text-[#4A4658]">{k.desc}</span>
              </button>
            ))}
          </div>
        </MotionList>
      </FormSheet>
    );
  }

  const opt = KIND_OPTIONS.find(k => k.kind === kind)!;
  const inst = INSTITUTION_LABEL[kind];
  const shownName = nameTouched ? name : suggestedName(kind, currency, institution);
  const amountNum = parseAmount(amount) || 0;
  const tnaNum = parseAmount(tna) || 0;
  const isPf = kind === "plazo_fijo";
  const needsTna = isPf || kind === "cuenta";
  const atMaturity = isPf && amountNum > 0 && tnaNum > 0 && maturity > start
    ? simpleAtMaturity(amountNum, tnaNum, start, maturity) : null;

  // El vencimiento sigue a la fecha de inicio hasta que la persona lo toca.
  function changeStart(v: string) {
    setStart(v);
    if (!maturityTouched && v) setMaturity(format(addDays(parseISO(v), 30), "yyyy-MM-dd"));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!(amountNum > 0)) { setError("Poné cuánto pusiste."); return; }
    if (!shownName.trim()) { setError("Ponele un nombre."); return; }
    if (needsTna && !(tna.trim() && tnaNum >= 0)) { setError("Decime la tasa (TNA)."); return; }
    if (start > today()) { setError("La fecha de comienzo no puede ser futura."); return; }
    if (isPf && !(maturity > start)) { setError("El vencimiento tiene que ser después del día en que lo hiciste."); return; }
    const currentNum = parseAmount(current);
    setSaving(true);
    try {
      const { data } = await api.post<Investment>("/investments", {
        name: shownName.trim(),
        kind: opt.kind,
        currency,
        institution: institution.trim() || undefined,
        tna: needsTna ? tnaNum : undefined,
        start_date: start || undefined,
        maturity_date: isPf ? maturity : undefined,
        amount: amountNum,
        current_value: isMarket(opt.kind) && current.trim() && currentNum >= 0 ? currentNum : undefined,
      });
      onSaved(data);
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo guardar la inversión."));
      setSaving(false);
    }
  }

  return (
    <FormSheet title="Los datos" onClose={onClose}>
      <MotionList className={STEP}>
        <form onSubmit={submit} className={FORM_SHEET_FORM} noValidate>
          <div className={FORM_SHEET_BODY}>
            <div className="flex items-center gap-2 px-1">
              <Chip tone="violet">{opt.label}</Chip>
              <button type="button" onClick={() => setKind(null)} className="min-h-[36px] px-1 text-sm font-medium text-[#3B2FB3] underline-offset-2 hover:underline">
                Cambiar
              </button>
            </div>
            <AmountField
              label="¿Cuánto pusiste?"
              currency={currency}
              toggle={
                <SegmentedToggle ariaLabel="Moneda" className="w-[120px]" value={currency} onChange={setCurrency}
                  options={[{ value: "ARS", label: "$" }, { value: "USD", label: "U$D" }]} />
              }
              value={amount}
              onChange={e => setAmount(e.target.value)}
              autoFocus
              required
            />
            <div>
              <label htmlFor="inv-inst" className={LABEL}>{inst.label} <span className="font-normal">(opcional)</span></label>
              <input id="inv-inst" className={FIELD} maxLength={80} placeholder={inst.placeholder}
                value={institution} onChange={e => setInstitution(e.target.value)} />
            </div>
            <div>
              <label htmlFor="inv-name" className={LABEL}>Nombre</label>
              <input id="inv-name" className={FIELD} maxLength={80} required
                value={shownName} onChange={e => { setNameTouched(true); setName(e.target.value); }} />
            </div>

            {needsTna && <TnaField id="inv-tna" value={tna} onChange={setTna} hint={isPf ? "la que te dio el banco" : "la que paga hoy"} />}

            <div>
              <span className={LABEL}>{isPf ? "Lo hiciste el" : "¿Desde cuándo lo tenés?"}</span>
              <DateField value={start} onChange={changeStart} required />
            </div>

            {isPf && (
              <div>
                <span className={LABEL}>Vence el</span>
                <DateField value={maturity} onChange={v => { setMaturityTouched(true); setMaturity(v); }} required />
                {start && <MaturityShortcuts from={start} value={maturity} onPick={v => { setMaturityTouched(true); setMaturity(v); }} />}
              </div>
            )}

            {isMarket(kind) && (
              <div>
                <label htmlFor="inv-current" className={LABEL}>¿Cuánto vale hoy? <span className="font-normal">(opcional)</span></label>
                <input id="inv-current" className={`${FIELD} tabular-nums`} type="text" inputMode="decimal" pattern="[0-9.,]*"
                  placeholder={amount || "0"} value={current} onChange={e => setCurrent(e.target.value)} />
                <p className="mt-1 px-1 text-xs text-muted-foreground">Si lo tenés hace tiempo, lo que figura hoy en {kind === "acciones" ? "el broker" : "tu cuenta"}. Si no, vale lo que pusiste.</p>
              </div>
            )}

            {atMaturity !== null && (
              <p className={NOTE} aria-live="polite">
                Al vencer vas a tener <strong className="font-semibold tabular-nums">{money(atMaturity, currency)}</strong>
                <span className="text-[#4A4658]"> (ganás {money(atMaturity - amountNum, currency)})</span>.
              </p>
            )}
            {kind === "cuenta" && tnaNum > 0 && (
              <p className="px-1 text-sm leading-snug text-[#4A4658]">Lo que rinde se calcula solo con la TNA, todos los días. Si cambia la tasa, la editás.</p>
            )}

            {first && (
              <p className="px-1 text-sm leading-snug text-[#4A4658]">
                Poner plata acá no es un gasto, y lo que rinde no es un ingreso hasta que lo rescatás: no aparece en Movimientos.
              </p>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <FormSheetActions onCancel={onClose} saving={saving} label="Guardar" />
        </form>
      </MotionList>
    </FormSheet>
  );
}

/** Editar lo que no es plata: nombre, dónde está, la tasa y el vencimiento. */
export function EditInvestmentForm({ inv, onSaved, onClose }: { inv: Investment; onSaved: () => void; onClose: () => void }) {
  const [name, setName] = useState(inv.name);
  const [institution, setInstitution] = useState(inv.institution ?? "");
  const [tna, setTna] = useState(inv.tna !== null ? amountText(inv.tna) : "");
  const [maturity, setMaturity] = useState(inv.maturity_date ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isPf = inv.kind === "plazo_fijo";
  const hasTna = isPf || inv.kind === "cuenta";
  const inst = INSTITUTION_LABEL[inv.kind];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) { setError("Ponele un nombre."); return; }
    if (hasTna && !tna.trim()) { setError("Decime la tasa (TNA)."); return; }
    setSaving(true);
    try {
      await api.patch(`/investments/${inv.id}`, {
        name: name.trim(),
        institution: institution.trim() || null,
        ...(hasTna ? { tna: parseAmount(tna) } : {}),
        ...(isPf && maturity ? { maturity_date: maturity } : {}),
      });
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo guardar."));
      setSaving(false);
    }
  }

  return (
    <FormSheet title="Editar inversión" onClose={onClose}>
      <form onSubmit={submit} className={FORM_SHEET_FORM} noValidate>
        <div className={FORM_SHEET_BODY}>
          <div>
            <label htmlFor="edit-name" className={LABEL}>Nombre</label>
            <input id="edit-name" className={FIELD} maxLength={80} value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="edit-inst" className={LABEL}>{inst.label} <span className="font-normal">(opcional)</span></label>
            <input id="edit-inst" className={FIELD} maxLength={80} placeholder={inst.placeholder}
              value={institution} onChange={e => setInstitution(e.target.value)} />
          </div>
          {hasTna && <TnaField id="edit-tna" value={tna} onChange={setTna} />}
          {isPf && (
            <div>
              <span className={LABEL}>Vence el</span>
              <DateField value={maturity} onChange={setMaturity} required />
            </div>
          )}
          {hasTna && (
            <p className="px-1 text-sm leading-snug text-[#4A4658]">La tasa nueva rige para todo el cálculo. Si el banco te muestra otro valor, cargalo con Actualizar valor.</p>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <FormSheetActions onCancel={onClose} saving={saving} label="Guardar" />
      </form>
    </FormSheet>
  );
}

export type MovementMode = "deposit" | "withdrawal" | "valuation";

const MOVEMENT_COPY: Record<MovementMode, { title: string; label: string; save: string }> = {
  deposit: { title: "Poner más", label: "¿Cuánto pusiste?", save: "Guardar" },
  withdrawal: { title: "Sacar", label: "¿Cuánto sacaste?", save: "Guardar" },
  valuation: { title: "Actualizar valor", label: "¿Cuánto vale hoy?", save: "Actualizar" },
};

/** Poner más, sacar o cargar lo que vale: los tres son un monto y una fecha. */
export function MovementForm({ inv, mode, onSaved, onClose }: {
  inv: Investment;
  mode: MovementMode;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const copy = MOVEMENT_COPY[mode];
  const value = Number(inv.value);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const n = parseAmount(amount);
    if (!(n > 0)) { setError("Poné un monto."); return; }
    setSaving(true);
    try {
      await api.post(`/investments/${inv.id}/movements`, {
        kind: mode, amount: n, movement_date: date || undefined, note: note.trim() || undefined,
      });
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo guardar."));
      setSaving(false);
    }
  }

  let footer: React.ReactNode;
  if (mode === "withdrawal" && value > 0) {
    footer = <p className="mt-1 text-xs text-muted-foreground">Hoy vale {money(value, inv.currency)}.</p>;
  } else if (mode === "valuation") {
    footer = (
      <p className="mt-1 text-xs leading-snug text-muted-foreground">
        {isMarket(inv.kind)
          ? `Todo junto, como figura en ${inv.institution || "tu cuenta"}.${inv.value_date && inv.stale_days !== null ? ` La última vez: ${money(value, inv.currency)}, ${ago(inv.stale_days)}.` : ""}`
          : `Si el banco dice otra cosa que el cálculo, manda el banco: desde ese valor se sigue calculando con la tasa.`}
      </p>
    );
  }

  return (
    <FormSheet title={copy.title} onClose={onClose}>
      <form onSubmit={submit} className={FORM_SHEET_FORM} noValidate>
        <div className={FORM_SHEET_BODY}>
          <AmountField label={copy.label} currency={inv.currency} value={amount}
            onChange={e => setAmount(e.target.value)} autoFocus required footer={footer} />
          <div>
            <span className={LABEL}>{mode === "valuation" ? "Valor del día" : "Fecha"}</span>
            <DateField value={date} onChange={setDate} required />
          </div>
          {mode !== "valuation" && (
            <div>
              <label htmlFor="mov-note" className={LABEL}>Nota <span className="font-normal">(opcional)</span></label>
              <input id="mov-note" className={FIELD} maxLength={255} value={note} onChange={e => setNote(e.target.value)}
                placeholder={mode === "deposit" ? "Del aguinaldo, lo que sobró del mes…" : "Para qué lo sacaste"} />
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <FormSheetActions onCancel={onClose} saving={saving} label={copy.save} />
      </form>
    </FormSheet>
  );
}

type RenewMoney = "all" | "interest" | "add";

/** Renovar un plazo fijo vencido: lo que valía al vencer pasa al plazo nuevo. */
export function RenewForm({ inv, onSaved, onClose }: { inv: Investment; onSaved: () => void; onClose: () => void }) {
  const from = inv.maturity_date!;
  const atOld = Number(inv.value_at_maturity ?? inv.value);
  const interest = Math.max(atOld - Number(inv.invested), 0);
  const [maturity, setMaturity] = useState(() => format(addDays(parseISO(from), 30), "yyyy-MM-dd"));
  const [tna, setTna] = useState(inv.tna !== null ? amountText(inv.tna) : "");
  const [how, setHow] = useState<RenewMoney>("all");
  const [add, setAdd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const tnaNum = parseAmount(tna) || 0;
  const addNum = how === "add" ? parseAmount(add) || 0 : 0;
  const take = how === "interest" ? Math.round(interest * 100) / 100 : 0;
  const base = atOld + addNum - take;
  const next = tnaNum > 0 && maturity > from ? simpleAtMaturity(base, tnaNum, from, maturity) : null;

  const options: { value: RenewMoney; label: string }[] = [
    { value: "all", label: "Todo" },
    ...(interest >= 0.01 ? [{ value: "interest" as const, label: "Sin el interés" }] : []),
    { value: "add", label: "Sumo plata" },
  ];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!(maturity > from)) { setError("El vencimiento nuevo tiene que ser después del anterior."); return; }
    if (!tna.trim()) { setError("Decime la tasa (TNA)."); return; }
    if (how === "add" && !(addNum > 0)) { setError("Poné cuánto sumás."); return; }
    setSaving(true);
    try {
      await api.post(`/investments/${inv.id}/renew`, {
        maturity_date: maturity,
        tna: tnaNum,
        add: addNum > 0 ? addNum : undefined,
        take: take > 0 ? take : undefined,
      });
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo renovar."));
      setSaving(false);
    }
  }

  return (
    <FormSheet title="Renovar el plazo fijo" onClose={onClose}>
      <form onSubmit={submit} className={FORM_SHEET_FORM} noValidate>
        <div className={FORM_SHEET_BODY}>
          <p className="px-1 text-[15px] leading-snug text-foreground">
            El {shortDate(from)} valía <strong className="font-semibold tabular-nums">{money(atOld, inv.currency)}</strong>.
            {interest >= 0.01 && <span className="text-[#4A4658]"> {money(interest, inv.currency)} son interés.</span>}
          </p>
          <div>
            <span className={LABEL}>¿Qué renovás?</span>
            <SegmentedToggle ariaLabel="Qué renovás" className="mt-1 w-full" value={how} onChange={setHow} options={options} />
          </div>
          {how === "add" && (
            <AmountField label="¿Cuánto sumás?" currency={inv.currency} value={add} onChange={e => setAdd(e.target.value)} autoFocus />
          )}
          <div>
            <span className={LABEL}>Vence el</span>
            <DateField value={maturity} onChange={setMaturity} required />
            <MaturityShortcuts from={from} value={maturity} onPick={setMaturity} />
          </div>
          <TnaField id="renew-tna" value={tna} onChange={setTna} hint={inv.tna ? `antes ${tnaText(inv.tna)}` : undefined} />
          <p className={NOTE} aria-live="polite">
            Renovás <strong className="font-semibold tabular-nums">{money(base, inv.currency)}</strong>
            {take > 0 && <span className="text-[#4A4658]"> y sacás {money(take, inv.currency)}</span>}.
            {next !== null && <> Al vencer vas a tener <strong className="font-semibold tabular-nums">{money(next, inv.currency)}</strong>.</>}
          </p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <FormSheetActions onCancel={onClose} saving={saving} label="Renovar" />
      </form>
    </FormSheet>
  );
}

/** Rescatar: lo que entró de verdad. La diferencia con lo puesto es lo que ganaste. */
export function CloseForm({ inv, onSaved, onClose }: { inv: Investment; onSaved: (gain: number) => void; onClose: () => void }) {
  const suggested = inv.matured && inv.value_at_maturity ? Number(inv.value_at_maturity) : Number(inv.value);
  const [amount, setAmount] = useState(suggested > 0 ? amountText(suggested) : "");
  const [date, setDate] = useState(inv.matured && inv.maturity_date ? inv.maturity_date : today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const n = parseAmount(amount) || 0;
  const gain = n - Number(inv.invested);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!amount.trim() || n < 0) { setError("Poné cuánto entró."); return; }
    setSaving(true);
    try {
      await api.post(`/investments/${inv.id}/close`, { amount: n, close_date: date || undefined });
      onSaved(gain);
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo rescatar."));
      setSaving(false);
    }
  }

  return (
    <FormSheet title="Rescatar" onClose={onClose}>
      <form onSubmit={submit} className={FORM_SHEET_FORM} noValidate>
        <div className={FORM_SHEET_BODY}>
          <AmountField label="¿Cuánto entró al rescatar?" currency={inv.currency} value={amount}
            onChange={e => setAmount(e.target.value)} autoFocus required
            footer={<p className="mt-1 text-xs text-muted-foreground">Lo que te depositaron de verdad, con comisiones e impuestos ya descontados.</p>} />
          <div>
            <span className={LABEL}>Fecha</span>
            <DateField value={date} onChange={setDate} required />
          </div>
          {amount.trim() && (
            <p className={NOTE} aria-live="polite">
              {Math.abs(gain) < 0.005
                ? "Sale igual que lo que pusiste."
                : gain > 0
                  ? <>En total ganaste <strong className="font-semibold tabular-nums text-emerald-800">{money(gain, inv.currency)}</strong>.</>
                  : <>En total perdiste <strong className="font-semibold tabular-nums">{money(-gain, inv.currency)}</strong>.</>}
              <span className="block mt-1 text-sm text-[#4A4658]">No se carga solo como ingreso. Si te equivocaste, el rescate se deshace.</span>
            </p>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <FormSheetActions onCancel={onClose} saving={saving} label="Rescatar" />
      </form>
    </FormSheet>
  );
}
