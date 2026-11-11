"use client";

import { useEffect, useRef, useState } from "react";
import { addMonths, format } from "date-fns";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { Chip } from "@/components/ui/chip";
import { CurrencyToggle, DateField, FIELD, FormGrid, MonthField, SegmentedToggle } from "@/components/ui/form";
import { MotionList } from "@/components/ui/motion-list";
import { AmountField, FORM_SHEET_BODY, FORM_SHEET_FORM, FormSheet, FormSheetActions } from "@/components/movimientos/FormSheet";
import {
  AMORTIZATION_TEXT, CUOTA_UNITS, DEFAULT_CUOTAS, KIND_OPTIONS, LABEL, OPTION, PAY_OPTIONS,
  adjustmentText, fmtDecimal, money, parseDecimalInput, parseRate,
  type Amortization, type Credit, type Currency, type Kind, type PayOption,
} from "./shared";

// Los pasos del alta comparten este padre, así uno se funde con el otro.
const STEP = "flex-1 min-h-0 flex flex-col";

interface Preview {
  first_amount: string | null;
  first_units: string | null;
  last_amount: string | null;
  last_units: string | null;
  total_units: string | null;
  estimated: boolean;
}

const DESCRIPTION_LABEL: Record<Kind, { label: string; placeholder: string }> = {
  hipotecario: { label: "Banco", placeholder: "ej: Banco Nación" },
  personal: { label: "Banco o app", placeholder: "ej: Mercado Pago" },
  prendario: { label: "Banco o concesionaria", placeholder: "ej: Banco Galicia" },
  plan_ahorro: { label: "Plan", placeholder: "ej: Plan Rombo, Peugeot 208" },
  particular: { label: "Quién te lo prestó", placeholder: "ej: Mi viejo" },
  otro: { label: "Quién te lo dio", placeholder: "ej: Mutual" },
};

function nextMonth(): string {
  return format(addMonths(new Date(), 1), "yyyy-MM");
}

/**
 * El alta y la edición de un crédito. El alta va en tres pasos: qué es, cómo se
 * paga y los datos, con la cuota que queda a la vista antes de guardar. Editar
 * abre directo en los datos y sólo con lo que se puede corregir: el tipo, el
 * ajuste y el sistema de un crédito no se cambian (se borra y se crea).
 */
export function CreditForm({ edit, onClose, onSaved }: {
  edit: Credit | null;
  onClose: () => void;
  onSaved: (credit: Credit) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(edit ? 3 : 1);
  const [kind, setKind] = useState<Kind>(edit?.kind ?? "hipotecario");
  const [opt, setOpt] = useState<PayOption | null>(null);
  const [cuotaUnit, setCuotaUnit] = useState<"ARS" | "UVA" | "USD">("ARS");
  const [currency, setCurrency] = useState<Currency>("ARS");
  const [capitalIn, setCapitalIn] = useState<"ARS" | "UVA">("ARS");
  const [amortization, setAmortization] = useState<Amortization>("frances");
  const [showSistema, setShowSistema] = useState(false);
  const [form, setForm] = useState(() => ({
    description: edit?.description ?? "",
    loan_number: edit?.loan_number ?? "",
    total_cuotas: String(edit?.total_cuotas ?? DEFAULT_CUOTAS.hipotecario),
    first_payment_date: nextMonth(),
    payment_day_mode: (edit?.payment_day != null ? "fixed" : "biz") as "biz" | "fixed",
    payment_day: edit?.payment_day != null ? String(edit.payment_day) : "",
    // Precargados: lo que se manda vacío borraría el que ya estaba.
    cuota: edit ? fmtDecimal(edit.adjustment === "uva" ? edit.cuota_uva : edit.cuota_pesos) : "",
    capital: edit && edit.adjustment !== "uva" ? fmtDecimal(edit.capital) : "",
    capital_uva: edit ? fmtDecimal(edit.original_capital_uva) : "",
    disbursement_date: "",
    tna: edit ? fmtDecimal(edit.tna) : "",
    plan_status: (edit?.plan_status ?? "suscripto") as "suscripto" | "adjudicado",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const seq = useRef(0);

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const pickKind = (k: Kind) => {
    setKind(k);
    setForm(p => ({ ...p, total_cuotas: String(DEFAULT_CUOTAS[k]) }));
    setCuotaUnit(CUOTA_UNITS[k][0]);
    if (k === "plan_ahorro") { setOpt(null); setStep(3); }
    else setStep(2);
  };

  const pickOpt = (o: PayOption) => {
    setOpt(o);
    setCurrency(o.currency);
    setAmortization(o.amortization ?? "frances");
    setShowSistema(false);
    setStep(3);
  };

  // ── Lo que se manda ─────────────────────────────────────────────────────────
  const method = edit ? edit.method : kind === "plan_ahorro" ? "manual" : opt?.method ?? "manual";
  const isPlan = kind === "plan_ahorro";
  const paymentDay = form.payment_day_mode === "fixed" && form.payment_day ? parseInt(form.payment_day) : null;
  const rateOptional = !!opt && (opt.noInterest || opt.amortization === "americano");

  /** El cuerpo del alta, o el motivo por el que todavía no se puede mandar. */
  function buildCreate(): { body: Record<string, unknown> } | { missing: string } {
    const cuotas = parseInt(form.total_cuotas);
    if (!cuotas || cuotas < 1) return { missing: "Decime cuántas cuotas son." };
    if (!form.first_payment_date) return { missing: "Elegí el mes de la primera cuota." };
    if (form.payment_day_mode === "fixed" && (!paymentDay || paymentDay < 1 || paymentDay > 28)) {
      return { missing: "El día de pago va del 1 al 28." };
    }
    const body: Record<string, unknown> = {
      kind,
      description: form.description.trim() || null,
      loan_number: form.loan_number.trim() || null,
      total_cuotas: cuotas,
      first_payment_date: `${form.first_payment_date}-01`,
      payment_day: paymentDay,
      amortization,
    };
    if (isPlan) return { body: { ...body, method: "manual", plan_status: form.plan_status } };
    if (!opt) return { missing: "Elegí cómo se paga." };
    if (opt.method === "manual") {
      return { body: { ...body, method: "manual", adjustment: "fija", currency } };
    }
    if (opt.method === "cuota") {
      const cuota = parseDecimalInput(form.cuota);
      if (!cuota) return { missing: "Decime cuánto es la cuota." };
      return {
        body: cuotaUnit === "UVA"
          ? { ...body, method: "cuota", adjustment: "uva", currency: "ARS", cuota_uva: cuota }
          : { ...body, method: "cuota", adjustment: "fija", currency: cuotaUnit, cuota_pesos: cuota },
      };
    }
    // Con la fórmula.
    const tna = opt.noInterest ? 0 : parseRate(form.tna) ?? (rateOptional ? 0 : null);
    if (tna == null) return { missing: "Decime la tasa nominal anual (TNA)." };
    const cur = opt.pickCurrency ? currency : opt.currency;
    if (opt.adjustment === "uva") {
      if (capitalIn === "UVA") {
        const units = parseDecimalInput(form.capital_uva);
        if (!units) return { missing: "Decime el capital en UVA." };
        return { body: { ...body, method: "formula", adjustment: "uva", currency: "ARS", tna, original_capital_uva: units } };
      }
      const capital = parseDecimalInput(form.capital);
      if (!capital) return { missing: "Decime el capital que te dieron." };
      if (!form.disbursement_date) return { missing: "Decime qué día te lo dieron: con la UVA de ese día se pasa a UVA." };
      return { body: { ...body, method: "formula", adjustment: "uva", currency: "ARS", tna, capital, disbursement_date: form.disbursement_date } };
    }
    const capital = parseDecimalInput(form.capital);
    if (!capital) return { missing: "Decime el capital que te prestaron." };
    return { body: { ...body, method: "formula", adjustment: "fija", currency: cur, tna, capital } };
  }

  // La cuota a la vista mientras se completa: con un respiro entre tecla y tecla.
  const built = !edit && step === 3 ? buildCreate() : null;
  const previewKey = built && "body" in built && method !== "manual" ? JSON.stringify(built.body) : "";
  useEffect(() => {
    if (!previewKey) { setPreview(null); return; }
    const mine = ++seq.current;
    const t = setTimeout(() => {
      api.post<Preview>("/credits/preview", JSON.parse(previewKey))
        .then(({ data }) => { if (mine === seq.current) setPreview(data); })
        .catch(() => { if (mine === seq.current) setPreview(null); });
    }, 450);
    return () => clearTimeout(t);
  }, [previewKey]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (edit) {
      if (form.payment_day_mode === "fixed" && (!paymentDay || paymentDay < 1 || paymentDay > 28)) {
        setError("El día de pago va del 1 al 28."); return;
      }
      const cuotas = parseInt(form.total_cuotas);
      if (!cuotas || cuotas < 1) { setError("Decime cuántas cuotas son."); return; }
      const body: Record<string, unknown> = {
        description: form.description.trim() || null,
        loan_number: form.loan_number.trim() || null,
        payment_day: paymentDay,
        total_cuotas: cuotas,
      };
      if (edit.method === "cuota") {
        const cuota = parseDecimalInput(form.cuota);
        if (!cuota) { setError("La cuota no puede quedar vacía."); return; }
        body[edit.adjustment === "uva" ? "cuota_uva" : "cuota_pesos"] = cuota;
      }
      if (edit.method === "formula") {
        const tna = parseRate(form.tna);
        if (tna == null) { setError("Decime la tasa nominal anual (TNA)."); return; }
        body.tna = tna;
        const principal = parseDecimalInput(edit.adjustment === "uva" ? form.capital_uva : form.capital);
        if (!principal) { setError("El capital no puede quedar vacío."); return; }
        body[edit.adjustment === "uva" ? "original_capital_uva" : "capital"] = principal;
      }
      if (edit.kind === "plan_ahorro") body.plan_status = form.plan_status;
      setSaving(true);
      try {
        const { data } = await api.patch<Credit>(`/credits/${edit.id}`, body);
        onSaved(data);
        onClose();
      } catch (err) {
        setError(getErrorMessage(err, "No se pudo guardar el crédito. Probá de nuevo."));
      } finally { setSaving(false); }
      return;
    }
    const res = buildCreate();
    if ("missing" in res) { setError(res.missing); return; }
    setSaving(true);
    try {
      const { data } = await api.post<Credit>("/credits", res.body);
      onSaved(data);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo guardar el crédito. Probá de nuevo."));
    } finally { setSaving(false); }
  };

  // ── Paso 1: qué es ──────────────────────────────────────────────────────────
  if (step === 1) {
    return (
      <FormSheet title="¿Qué crédito es?" onClose={onClose}>
        <MotionList className={STEP}>
          <div className="flex-1 min-h-0 overflow-y-auto px-3.5 pb-3.5 space-y-2">
            {KIND_OPTIONS.map(k => (
              <button key={k.kind} type="button" className={OPTION} onClick={() => pickKind(k.kind)}>
                <span className="block text-[15.5px] font-semibold text-foreground">{k.label}</span>
                <span className="block mt-0.5 text-sm leading-snug text-[#4A4658]">{k.desc}</span>
              </button>
            ))}
          </div>
        </MotionList>
      </FormSheet>
    );
  }

  const kindLabel = KIND_OPTIONS.find(k => k.kind === kind)?.label ?? "";

  // ── Paso 2: cómo se paga ────────────────────────────────────────────────────
  if (step === 2 && !isPlan) {
    return (
      <FormSheet title="¿Cómo se paga?" onClose={onClose}>
        <MotionList className={STEP}>
          <div className="flex-1 min-h-0 overflow-y-auto px-3.5 pb-3.5 space-y-2">
            <div className="flex items-center gap-2 px-1 pb-1">
              <Chip tone="violet">{kindLabel}</Chip>
              <button type="button" onClick={() => setStep(1)} className="min-h-[36px] px-1 text-sm font-medium text-[#3B2FB3] underline-offset-2 hover:underline">
                Cambiar
              </button>
            </div>
            {PAY_OPTIONS[kind as Exclude<Kind, "plan_ahorro">].map(o => (
              <button key={o.id} type="button" className={OPTION} onClick={() => pickOpt(o)}>
                <span className="block text-[15.5px] font-semibold text-foreground">{o.label}</span>
                <span className="block mt-0.5 text-sm leading-snug text-[#4A4658]">{o.desc}</span>
              </button>
            ))}
          </div>
        </MotionList>
      </FormSheet>
    );
  }

  // ── Paso 3: los datos ───────────────────────────────────────────────────────
  const editAdjustment = edit ? adjustmentText(edit) : null;
  const descText = DESCRIPTION_LABEL[kind];
  const isUvaFormula = !edit && opt?.method === "formula" && opt.adjustment === "uva";
  const askRate = edit ? edit.method === "formula" : opt?.method === "formula" && !opt.noInterest;
  const askSistema = !edit && opt?.method === "formula" && !opt.amortization && !opt.noInterest;
  const units = CUOTA_UNITS[kind];
  const firstInPast = !edit && method !== "manual" && !!form.first_payment_date
    && form.first_payment_date <= format(new Date(), "yyyy-MM");
  const shownCurrency: Currency = edit ? edit.currency : opt?.method === "cuota" ? (cuotaUnit === "USD" ? "USD" : "ARS") : (opt?.pickCurrency ? currency : opt?.currency ?? "ARS");

  return (
    <FormSheet title={edit ? "Editar crédito" : "Los datos del crédito"} onClose={onClose}>
      <MotionList className={STEP}>
        <form onSubmit={handleSave} className={FORM_SHEET_FORM} noValidate>
          <MotionList className={FORM_SHEET_BODY}>
            <div className="flex flex-wrap items-center gap-2 px-1">
              <Chip tone="violet">{edit ? edit.kind_label : kindLabel}</Chip>
              {(edit ? editAdjustment : opt?.label) && <Chip tone="neutral">{edit ? editAdjustment : opt?.label}</Chip>}
              {!edit && (
                <button type="button" onClick={() => setStep(isPlan ? 1 : 2)} className="min-h-[36px] px-1 text-sm font-medium text-[#3B2FB3] underline-offset-2 hover:underline">
                  Cambiar
                </button>
              )}
            </div>
            {edit && (
              <p className="px-1.5 text-sm leading-snug text-[#4A4658]">
                Lo que cambies rige para las cuotas que faltan. Las que ya se registraron quedan como están.
              </p>
            )}

            {/* La cuota que la persona ya sabe. */}
            {!edit && opt?.method === "cuota" && units.length > 1 && (
              <div>
                <label className={LABEL}>La cuota está en</label>
                <SegmentedToggle ariaLabel="La cuota está en" className="mt-1" value={cuotaUnit} onChange={setCuotaUnit}
                  options={units.map(u => ({ value: u, label: u === "ARS" ? "Pesos" : u === "USD" ? "Dólares" : "UVA" }))} />
              </div>
            )}
            {((!edit && opt?.method === "cuota") || edit?.method === "cuota") && (
              (edit ? edit.adjustment === "uva" : cuotaUnit === "UVA") ? (
                <div>
                  <label className={LABEL}>Cuota en UVA</label>
                  <input type="text" inputMode="decimal" placeholder="ej: 750,74" aria-label="Cuota en UVA"
                    value={form.cuota} onChange={f("cuota")} className={`${FIELD} tabular-nums`} />
                </div>
              ) : (
                <AmountField label="Cuota mensual" currency={shownCurrency} value={form.cuota} onChange={f("cuota")} />
              )
            )}

            {/* El capital, para calcular la cuota. */}
            {isUvaFormula && (
              <div>
                <label className={LABEL}>El capital lo tengo en</label>
                <SegmentedToggle ariaLabel="El capital lo tengo en" className="mt-1" value={capitalIn} onChange={setCapitalIn}
                  options={[{ value: "ARS", label: "Pesos" }, { value: "UVA", label: "UVA" }]} />
              </div>
            )}
            {((isUvaFormula && capitalIn === "ARS") || (!edit && opt?.method === "formula" && opt.adjustment === "fija") || (edit?.method === "formula" && edit.adjustment === "fija")) && (
              <AmountField label="Capital que te prestaron" currency={shownCurrency} value={form.capital} onChange={f("capital")}
                toggle={!edit && opt?.pickCurrency ? <CurrencyToggle value={currency} onChange={setCurrency} className="w-[132px]" /> : undefined} />
            )}
            {isUvaFormula && capitalIn === "ARS" && (
              <div>
                <label className={LABEL}>Qué día te lo dieron</label>
                <DateField value={form.disbursement_date} onChange={v => setForm(p => ({ ...p, disbursement_date: v }))} />
                <p className="px-1.5 mt-1.5 text-sm leading-snug text-[#4A4658]">Con la UVA de ese día se pasa el capital a UVA.</p>
              </div>
            )}
            {((isUvaFormula && capitalIn === "UVA") || (edit?.method === "formula" && edit.adjustment === "uva")) && (
              <div>
                <label className={LABEL}>Capital en UVA</label>
                <input type="text" inputMode="decimal" placeholder="Figura en el contrato" aria-label="Capital en UVA"
                  value={form.capital_uva} onChange={f("capital_uva")} className={`${FIELD} tabular-nums`} />
              </div>
            )}

            {/* Lo que se carga a mano: sólo la moneda. */}
            {!edit && opt?.method === "manual" && (
              <div>
                <label className={LABEL}>Moneda</label>
                <SegmentedToggle ariaLabel="Moneda" className="mt-1" value={currency} onChange={setCurrency}
                  options={[{ value: "ARS", label: "Pesos" }, { value: "USD", label: "Dólares" }]} />
              </div>
            )}
            {(isPlan || (!edit && opt?.method === "manual")) && !edit && (
              <p className="px-1.5 text-sm leading-snug text-[#4A4658]">
                Cada mes cargás la cuota que pagaste, y se registra con su egreso.
              </p>
            )}

            <FormGrid>
              {askRate && (
                <div>
                  <label className={LABEL}>TNA %{rateOptional ? " (opcional)" : ""}</label>
                  <input type="text" inputMode="decimal" placeholder="ej: 8,50" aria-label="TNA"
                    value={form.tna} onChange={f("tna")} className={`${FIELD} tabular-nums`} />
                </div>
              )}
              <div>
                <label className={LABEL}>Cantidad de cuotas</label>
                <input type="text" inputMode="numeric" pattern="[0-9]*" aria-label="Cantidad de cuotas"
                  value={form.total_cuotas} onChange={f("total_cuotas")} className={`${FIELD} tabular-nums`} />
              </div>
              {!edit && (
                <div className={askRate ? "sm:col-span-2" : ""}>
                  <label className={LABEL}>Primera cuota</label>
                  <MonthField value={form.first_payment_date}
                    onChange={v => setForm(p => ({ ...p, first_payment_date: v }))} />
                </div>
              )}
            </FormGrid>
            {firstInPast && (
              <p className="px-1.5 -mt-1 text-sm leading-snug text-[#4A4658]">
                Las cuotas que ya vencieron se registran al guardar, cada una con su egreso.
              </p>
            )}

            {/* Al lado de lo que la mueve: el capital, la tasa y el plazo. */}
            {preview && <PreviewBox preview={preview} currency={shownCurrency} uva={(opt?.adjustment === "uva" && opt.method === "formula") || (opt?.method === "cuota" && cuotaUnit === "UVA")} />}
            {askSistema && (
              <div className="rounded-[22px] bg-white/70 border border-white/80 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-sm leading-snug text-[#4A4658]">
                    <span className="font-semibold text-foreground">Sistema {AMORTIZATION_TEXT[amortization].label.toLowerCase()}.</span>{" "}
                    {AMORTIZATION_TEXT[amortization].desc}
                  </p>
                  {!showSistema && (
                    <button type="button" onClick={() => setShowSistema(true)}
                      className="shrink-0 min-h-[36px] -my-1.5 px-1 text-sm font-medium text-[#3B2FB3] underline-offset-2 hover:underline">
                      Cambiar
                    </button>
                  )}
                </div>
                {showSistema && (
                  <SegmentedToggle ariaLabel="Sistema" className="mt-2.5" value={amortization} onChange={setAmortization}
                    options={(Object.keys(AMORTIZATION_TEXT) as Amortization[]).map(a => ({ value: a, label: AMORTIZATION_TEXT[a].label }))} />
                )}
              </div>
            )}

            <div>
              <label className={LABEL}>Fecha de pago de la cuota</label>
              <SegmentedToggle
                ariaLabel="Fecha de pago de la cuota" className="mt-1"
                value={form.payment_day_mode}
                onChange={mode => setForm(p => ({ ...p, payment_day_mode: mode, payment_day: mode === "biz" ? "" : p.payment_day }))}
                options={[{ value: "biz", label: "Primer día hábil" }, { value: "fixed", label: "Día específico" }]}
              />
              {form.payment_day_mode === "fixed" ? (
                <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} placeholder="Del 1 al 28" aria-label="Día de pago"
                  value={form.payment_day} onChange={f("payment_day")} className={`${FIELD} mt-2 tabular-nums`} />
              ) : (
                <p className="px-1.5 mt-1.5 text-sm leading-snug text-[#4A4658]">
                  Si el 1° cae sábado o domingo, se usa el lunes siguiente.
                </p>
              )}
            </div>

            {isPlan && (
              <div>
                <label className={LABEL}>Estado del plan</label>
                <SegmentedToggle ariaLabel="Estado del plan" className="mt-1" value={form.plan_status}
                  onChange={v => setForm(p => ({ ...p, plan_status: v }))}
                  options={[{ value: "suscripto", label: "Suscripto" }, { value: "adjudicado", label: "Adjudicado" }]} />
              </div>
            )}

            <FormGrid>
              <div>
                <label className={LABEL}>{descText.label} (opcional)</label>
                <input type="text" placeholder={descText.placeholder} aria-label={descText.label}
                  value={form.description} onChange={f("description")} className={FIELD} />
              </div>
              {kind !== "particular" && (
                <div>
                  <label className={LABEL}>{isPlan ? "Grupo y orden" : "N° de préstamo"} (opcional)</label>
                  <input type="text" aria-label={isPlan ? "Grupo y orden" : "N° de préstamo"}
                    value={form.loan_number} onChange={f("loan_number")} className={FIELD} />
                </div>
              )}
            </FormGrid>


            {error && <p role="alert" className="px-1.5 text-sm text-destructive">{error}</p>}
          </MotionList>
          <FormSheetActions onCancel={onClose} saving={saving} label={edit ? "Guardar cambios" : "Guardar crédito"} />
        </form>
      </MotionList>
    </FormSheet>
  );
}

/** "La cuota te queda en": para ver si cierra con lo del banco antes de guardar. */
function PreviewBox({ preview, currency, uva }: { preview: Preview; currency: Currency; uva: boolean }) {
  if (!preview.first_amount && !preview.first_units) return null;
  const first = preview.first_amount;
  const last = preview.last_amount;
  // Más de un peso de diferencia: en alemán o americano la última no es la primera.
  const lastDiffers = !uva && first && last && Math.abs(Number(last) - Number(first)) >= 1;
  const lastUnitsDiffers = uva && preview.first_units && preview.last_units
    && Math.abs(Number(preview.last_units) - Number(preview.first_units)) >= 0.01;
  return (
    <div className="rounded-[22px] bg-accent border border-[#CFC9E4] px-4 py-3 text-[15px] leading-snug text-foreground" aria-live="polite">
      {first ? (
        <p>
          La primera cuota te queda en{" "}
          <span className="font-semibold tabular-nums">{money(first, currency)}</span>
        </p>
      ) : (
        <p>Todavía no está la UVA de ese día para pasarla a pesos.</p>
      )}
      {uva && preview.first_units && (
        <p className="text-sm text-[#4A4658] tabular-nums">
          {fmtDecimal(preview.first_units)} UVA{lastUnitsDiffers && <> la primera, {fmtDecimal(preview.last_units)} UVA la última</>}
        </p>
      )}
      {lastDiffers && (
        <p className="text-sm text-[#4A4658]">La última, <span className="tabular-nums">{money(last!, currency)}</span>.</p>
      )}
      {preview.total_units && (
        <p className="text-sm text-[#4A4658]">
          En total devolvés <span className="tabular-nums">{uva ? `${fmtDecimal(preview.total_units)} UVA` : money(preview.total_units, currency)}</span>.
        </p>
      )}
      {preview.estimated && (
        <p className="text-sm text-[#4A4658]">Estimada: la UVA de ese día todavía no se conoce.</p>
      )}
    </div>
  );
}

