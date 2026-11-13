"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  isSameMonth, isSameDay, isToday, format, addMonths, subMonths, parseISO,
} from "date-fns";
import { es } from "date-fns/locale";
import { Plus, Trash2 } from "lucide-react";
import type { Step } from "react-joyride";

import api from "@/lib/api";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { cn, getErrorMessage } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { DateField, FIELD } from "@/components/ui/form";
import { MonthPill } from "@/components/dashboard/MonthPill";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { MotionList } from "@/components/ui/motion-list";
import { FORM_SHEET_BODY, FORM_SHEET_FORM, FormSheet, FormSheetActions } from "@/components/movimientos/FormSheet";
import { ledgerAmount } from "@/components/movimientos/Ledger";
import { useNuevo } from "@/lib/nuevo";
import ProductTour from "@/components/ProductTour";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const CALENDAR_TOUR_STEPS: Step[] = [
  {
    target: "[data-tour='cal-grid']",
    title: "Tu mes de un vistazo",
    content: "Cada día marca lo que pasa: un círculo vacío es el cierre de un resumen, uno negro el vencimiento, uno violeta un recordatorio y uno violeta vacío un recurrente a confirmar.",
  },
  {
    target: "[data-tour='cal-day']",
    title: "El día que elegiste",
    content: "Tocá un día en el calendario y acá ves qué cierra, qué vence y cuánto. Tocá una tarjeta para ir a su resumen.",
  },
  {
    target: "[data-tour='cal-add']",
    title: "Agregá un recordatorio",
    content: "Para que no se te pase un pago. Si vinculaste tu WhatsApp en Configuración, ese día te llega un mensaje.",
  },
];

interface StatementCal {
  id: number;
  card_id: number;
  card_alias: string;
  year: number;
  month: number;
  closing_date: string | null;
  due_date: string | null;
  status: string;
  total: number;
  total_usd?: number;
}

interface Reminder {
  id: number;
  title: string;
  remind_date: string;
  statement_id: number | null;
  notified: boolean;
  created_at: string;
}

interface PendingRecurrence {
  entry_id: number;
  description: string | null;
  amount: number;
  currency: string;
  date: string;
  card_alias: string | null;
  card_id: number | null;
  statement_id: number | null;
  item_id: number | null;
  overdue: boolean;
}

interface DayEvent {
  kind: "closing" | "due" | "reminder" | "recurring";
  label: string;
  amount?: number;
  amountUsd?: number;
  href?: string;
  reminder?: Reminder;
  sub?: string;
}

/** La misma marca en la grilla, en la leyenda y en el detalle del día. Sin rojo: rojo es error. */
function EventDot({ kind, inverted = false }: { kind: DayEvent["kind"]; inverted?: boolean }) {
  return (
    <span aria-hidden="true" className={cn(
      "block w-1.5 h-1.5 rounded-full shrink-0",
      // Hueco: el color sale del texto del día, así se ve también sobre el seleccionado.
      kind === "closing" && (inverted ? "text-background" : "text-foreground") + " shadow-[inset_0_0_0_1.25px_currentColor]",
      kind === "due" && (inverted ? "bg-background" : "bg-ink"),
      kind === "reminder" && (inverted ? "bg-[#B9B2FF]" : "bg-primary"),
      // Vacío y violeta: un gasto recurrente que ya suma pero falta confirmar.
      kind === "recurring" && (inverted ? "text-[#B9B2FF]" : "text-primary") + " shadow-[inset_0_0_0_1.25px_currentColor]",
    )} />
  );
}

function AddReminderModal({
  date, onSave, onClose,
}: {
  date: Date;
  onSave: (title: string, dateStr: string) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [dateStr, setDateStr] = useState(format(date, "yyyy-MM-dd"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setError("");
    setSaving(true);
    try {
      await onSave(title.trim(), dateStr);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "No se pudo guardar el recordatorio. Probá de nuevo."));
    }
    setSaving(false);
  };

  return (
    <FormSheet title="Nuevo recordatorio" onClose={onClose}>
      <form onSubmit={handleSubmit} className={FORM_SHEET_FORM}>
        <div className={FORM_SHEET_BODY}>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Texto</label>
            <input required autoFocus className={FIELD} placeholder="ej: Pagar tarjeta Visa" aria-label="Texto"
              value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Fecha</label>
            <DateField required value={dateStr} onChange={setDateStr} />
          </div>
          <p className="px-1.5 text-sm leading-snug text-[#4A4658]">
            Ese día te llega un WhatsApp, si vinculaste tu número en Configuración.
          </p>
          {error && <p role="alert" className="px-1.5 text-sm text-destructive">{error}</p>}
        </div>
        <FormSheetActions onCancel={onClose} saving={saving} label="Guardar recordatorio" />
      </form>
    </FormSheet>
  );
}

/** Borrar un recordatorio pregunta ahí mismo, en su propia fila. */
function ReminderRow({ event, onDelete }: { event: DayEvent; onDelete: (id: number) => Promise<string | null> }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const remove = async () => {
    const failed = await onDelete(event.reminder!.id);
    if (failed) { setError(failed); setConfirming(false); }
  };
  if (confirming) {
    return (
      <div role="alert" className="py-2.5">
        <p className="text-[15px] font-medium text-foreground">¿Eliminar «{event.label}»?</p>
        <div className="mt-2 flex items-center gap-2">
          <button autoFocus onClick={() => setConfirming(false)}
            className="h-11 px-4 rounded-full bg-ink/[0.06] text-sm font-semibold text-foreground active:scale-[0.97] transition-transform duration-100">
            No, dejarlo
          </button>
          <button onClick={remove}
            className="h-11 px-4 rounded-full bg-destructive text-destructive-foreground text-sm font-semibold active:scale-[0.97] transition-transform duration-100">
            Sí, eliminar
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-[56px] flex items-center gap-3 py-1.5">
      <EventDot kind="reminder" />
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-[15.5px] text-foreground truncate">{event.label}</span>
        <span className="block text-sm text-muted-foreground">{error || "Recordatorio"}</span>
      </span>
      <button onClick={() => { setError(""); setConfirming(true); }}
        title="Eliminar recordatorio" aria-label="Eliminar recordatorio"
        className="w-11 h-11 -mr-2 shrink-0 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors">
        <Trash2 className="w-[18px] h-[18px]" />
      </button>
    </div>
  );
}

/**
 * The selected day's events, always on screen under the calendar rather than
 * behind a click. The dots in the grid say *that* something happens; without
 * this you had to open a day to find out what, and the day you care about most
 * — today — was one more dot like any other.
 */
function DayDetail({
  date, events, isCurrent, onAddReminder, onDeleteReminder,
}: {
  date: Date;
  events: DayEvent[];
  isCurrent: boolean;
  onAddReminder: () => void;
  onDeleteReminder: (id: number) => Promise<string | null>;
}) {
  return (
    <section className="px-2" data-tour="cal-day">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="text-[22px] font-medium tracking-[-0.03em] text-foreground first-letter:uppercase">
          {format(date, "EEEE d 'de' MMMM", { locale: es })}
        </h2>
        {isCurrent && <Chip tone="violet" className="shrink-0">Hoy</Chip>}
      </div>

      {/* De un día a otro funde: agregar o borrar un recordatorio mueve sólo esa fila. */}
      <MotionList key={format(date, "yyyy-MM-dd")} className="animate-page-in">
      {events.length === 0 ? (
        <p className="py-2 text-[15px] text-muted-foreground">
          {isCurrent ? "Hoy no vence ni cierra nada, y no tenés recordatorios." : "Ese día no vence ni cierra nada, y no hay recordatorios."}
        </p>
      ) : (
        <MotionList className="divide-y divide-border">
          {events.map((ev, i) => ev.kind === "reminder" ? (
            <ReminderRow key={ev.reminder!.id} event={ev} onDelete={onDeleteReminder} />
          ) : (
            <Link key={i} href={ev.href!} className="min-h-[56px] flex items-center gap-3 py-1.5 active:opacity-60 transition-opacity">
              <EventDot kind={ev.kind} />
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-[15.5px] text-foreground truncate">{ev.label}</span>
                <span className="block text-sm text-muted-foreground truncate">
                  {ev.kind === "due" ? "Vencimiento" : ev.kind === "closing" ? "Cierre" : ev.sub}
                </span>
              </span>
              {(Number(ev.amount) > 0 || Number(ev.amountUsd) > 0) && (
                <span className="font-medium text-base tabular-nums text-foreground shrink-0 text-right">
                  {Number(ev.amount) > 0 && <span className="block">{ledgerAmount(ev.amount!)}</span>}
                  {Number(ev.amountUsd) > 0 && <span className="block">{ledgerAmount(ev.amountUsd!, "USD")}</span>}
                </span>
              )}
            </Link>
          ))}
        </MotionList>
      )}
      </MotionList>

      <button data-tour="cal-add" onClick={onAddReminder}
        className="mt-3 w-full min-h-[56px] flex items-center justify-between gap-3 rounded-full border border-border bg-card pl-5 pr-2 text-[15.5px] font-semibold text-foreground active:scale-[0.99] transition-transform duration-100">
        Agregar recordatorio
        <span className="w-10 h-10 rounded-full bg-ink text-background flex items-center justify-center shrink-0">
          <Plus className="w-[18px] h-[18px]" />
        </span>
      </button>
    </section>
  );
}

export default function CalendarioPage() {
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const reaccionar = useReaccion();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [statements, setStatements] = useState<StatementCal[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [recurring, setRecurring] = useState<PendingRecurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Starts on today: the day the user is standing on is the one they came to
  // check, and leaving the panel empty until they click somewhere hides it.
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());
  const [showAddReminder, setShowAddReminder] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const year = month.getFullYear();
    const m = month.getMonth() + 1;
    const [stRes, remRes, recRes] = await Promise.allSettled([
      api.get("/credit-cards/statements/calendar", { params: { year, month: m } }),
      api.get("/reminders", { params: { year, month: m } }),
      api.get("/recurrences/pending", { params: { year, month: m } }),
    ]);
    setStatements(stRes.status === "fulfilled" ? stRes.value.data : []);
    setReminders(remRes.status === "fulfilled" ? remRes.value.data : []);
    setRecurring(recRes.status === "fulfilled" ? recRes.value.data : []);
    setFailed(stRes.status === "rejected" || remRes.status === "rejected" || recRes.status === "rejected");
    setLoading(false);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  // Moving to another month leaves the panel describing a day that's no longer
  // on screen; land on today when it belongs to the new month, on its 1st
  // otherwise.
  useEffect(() => {
    setSelectedDay(prev => {
      if (isSameMonth(prev, month)) return prev;
      const today = new Date();
      return isSameMonth(today, month) ? today : month;
    });
  }, [month]);

  useNuevo(() => setShowAddReminder(true), "nuevo");

  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  function eventsForDay(day: Date): DayEvent[] {
    const events: DayEvent[] = [];
    for (const s of statements) {
      const href = `/tarjetas/${s.card_id}/${s.id}`;
      if (s.closing_date && isSameDay(parseISO(s.closing_date), day)) {
        events.push({ kind: "closing", label: s.card_alias, amount: s.total, amountUsd: s.total_usd, href });
      }
      if (s.due_date && isSameDay(parseISO(s.due_date), day)) {
        events.push({ kind: "due", label: s.card_alias, amount: s.total, amountUsd: s.total_usd, href });
      }
    }
    for (const r of reminders) {
      if (isSameDay(parseISO(r.remind_date), day)) {
        events.push({ kind: "reminder", label: r.title, reminder: r });
      }
    }
    for (const p of recurring) {
      if (isSameDay(parseISO(p.date), day)) {
        events.push({
          kind: "recurring",
          label: p.description || "Gasto recurrente",
          sub: p.card_alias ? `A confirmar · ${p.card_alias}` : "A confirmar",
          amount: p.currency === "USD" ? undefined : p.amount,
          amountUsd: p.currency === "USD" ? p.amount : undefined,
          // Se confirma desde su ficha: en el resumen si es de tarjeta, en Egresos si no.
          href: p.card_id && p.statement_id
            ? `/tarjetas/${p.card_id}/${p.statement_id}?item=${p.item_id}`
            : `/expenses?mes=${p.date.slice(0, 7)}&abrir=${p.entry_id}`,
        });
      }
    }
    return events;
  }

  async function handleAddReminder(title: string, dateStr: string) {
    await api.post("/reminders", { title, remind_date: dateStr });
    setShowAddReminder(false);
    // Stay on the day it was added to: the reminder shows up in the panel
    // underneath, which is the confirmation that it landed.
    const saved = parseISO(dateStr);
    setSelectedDay(saved);
    // Otro mes: el calendario va hasta ahí, y ése vuelve a cargar lo suyo.
    if (isSameMonth(saved, month)) await load();
    else setMonth(startOfMonth(saved));
    reaccionar("guardado", "Recordatorio guardado");
  }

  async function handleDeleteReminder(id: number): Promise<string | null> {
    try {
      await api.delete(`/reminders/${id}`);
      await load();
      reaccionar("borrado", "Recordatorio eliminado");
      return null;
    } catch (e) {
      reaccionar("error", "No se pudo eliminar");
      return getErrorMessage(e, "No se pudo eliminar. Probá de nuevo.");
    }
  }

  const selectedEvents = eventsForDay(selectedDay);
  const pillLabel = format(month, "MMM yyyy", { locale: es }).replace(".", "");

  return (
    <div className="space-y-4 md:space-y-6 pb-4">
      <ProductTour tourId="calendar-intro" steps={CALENDAR_TOUR_STEPS} />
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-[26px] md:text-3xl font-display font-medium tracking-[-0.035em] text-foreground">Calendario</h1>
        <MonthPill compact label={pillLabel}
          onPrev={() => setMonth(subMonths(month, 1))}
          onNext={() => setMonth(addMonths(month, 1))} />
      </div>

      {failed && (
        <div role="alert" className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] text-rose-900">
          <p>No pudimos traer todo lo de este mes, así que puede faltar algo.</p>
          <button onClick={load} className="mt-1 font-semibold underline">Probar de nuevo</button>
        </div>
      )}

      <Card className="p-2.5 md:p-4" data-tour="cal-grid">
        <div className="grid grid-cols-7 gap-0.5 mb-0.5">
          {WEEKDAYS.map((d) => (
            <div key={d} className="text-center font-marca text-xs text-muted-foreground py-1">{d}</div>
          ))}
        </div>

        <div className={cn("grid grid-cols-7 gap-0.5", loading && "opacity-50")}>
          {days.map((day) => {
            const events = eventsForDay(day);
            const inMonth = isSameMonth(day, month);
            const selected = isSameDay(day, selectedDay);
            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDay(day)}
                aria-label={format(day, "d 'de' MMMM", { locale: es }) + (events.length ? `, ${events.length} ${events.length === 1 ? "evento" : "eventos"}` : "")}
                aria-pressed={selected}
                className={cn(
                  "h-11 rounded-2xl pt-1 flex flex-col items-center justify-start transition-colors active:scale-[0.97]",
                  // Selected wins over today: today is where you start, the
                  // selection is where you're looking.
                  selected ? "bg-ink text-background"
                    : inMonth ? "text-foreground hover:bg-accent/60" : "text-muted-foreground/40",
                  !selected && isToday(day) && "bg-accent"
                )}
              >
                <span className={cn("text-[15px] leading-5 tabular-nums", isToday(day) && "font-semibold", !selected && isToday(day) && "text-[#3B2FB3]")}>
                  {format(day, "d")}
                </span>
                {events.length > 0 && (
                  <span className="mt-1 flex gap-0.5 justify-center">
                    {events.slice(0, 4).map((ev, i) => (
                      <EventDot key={i} kind={ev.kind} inverted={selected} />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5 pt-2.5 px-1.5 border-t border-border text-[13px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><EventDot kind="closing" /> Cierre</span>
          <span className="flex items-center gap-1.5"><EventDot kind="due" /> Vencimiento</span>
          <span className="flex items-center gap-1.5"><EventDot kind="reminder" /> Recordatorio</span>
          {recurring.length > 0 && <span className="flex items-center gap-1.5"><EventDot kind="recurring" /> A confirmar</span>}
        </div>
      </Card>

      <DayDetail
        date={selectedDay}
        events={selectedEvents}
        isCurrent={isToday(selectedDay)}
        onAddReminder={() => setShowAddReminder(true)}
        onDeleteReminder={handleDeleteReminder}
      />

      {showAddReminder && (
        <AddReminderModal
          date={selectedDay}
          onSave={handleAddReminder}
          onClose={() => setShowAddReminder(false)}
        />
      )}
    </div>
  );
}
