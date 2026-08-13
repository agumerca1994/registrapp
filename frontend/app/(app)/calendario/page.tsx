"use client";

import { useEffect, useState, useCallback } from "react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  isSameMonth, isSameDay, isToday, format, addMonths, subMonths, parseISO,
} from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, X, Trash2, Bell, CreditCard as CardIcon } from "lucide-react";

import api from "@/lib/api";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { formatARS, cn, getErrorMessage } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { FIELD, DateField } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

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
}

interface Reminder {
  id: number;
  title: string;
  remind_date: string;
  statement_id: number | null;
  notified: boolean;
  created_at: string;
}

interface DayEvent {
  kind: "closing" | "due" | "reminder";
  label: string;
  amount?: number;
  reminder?: Reminder;
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
      setError(getErrorMessage(err, "Error al crear el recordatorio"));
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <Card className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Nuevo recordatorio</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Texto *</label>
            <input required className={FIELD} placeholder="ej: Pagar tarjeta Visa"
              value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Fecha *</label>
            <DateField required value={dateStr} onChange={setDateStr} />
          </div>
          <p className="text-xs text-muted-foreground/70">
            Se te va a avisar por WhatsApp ese día (si tenés tu WhatsApp vinculado en Configuración).
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </form>
      </Card>
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
  onDeleteReminder: (id: number) => Promise<void>;
}) {
  return (
    <Card className="p-4 md:p-5 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-semibold text-foreground first-letter:uppercase">
          {format(date, "EEEE d 'de' MMMM", { locale: es })}
        </h3>
        {isCurrent && <Chip tone="neutral">Hoy</Chip>}
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground/70">
          {isCurrent ? "Hoy no vence ni cierra nada, y no tenés recordatorios." : "Sin eventos este día."}
        </p>
      ) : (
        <div className="space-y-2">
          {events.map((ev, i) => (
            <div key={i} className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
              ev.kind === "closing" ? "bg-orange-50 text-orange-700" :
              ev.kind === "due" ? "bg-rose-50 text-rose-700" :
              "bg-accent text-primary"
            )}>
              {ev.kind === "reminder" ? <Bell className="w-4 h-4 shrink-0" /> : <CardIcon className="w-4 h-4 shrink-0" />}
              <span className="flex-1 min-w-0 truncate">{ev.label}</span>
              {ev.amount !== undefined && <span className="font-medium shrink-0">{formatARS(ev.amount)}</span>}
              {ev.kind === "reminder" && ev.reminder && (
                <button onClick={() => onDeleteReminder(ev.reminder!.id)}
                  title="Eliminar recordatorio"
                  className="text-primary/50 hover:text-destructive shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <button onClick={onAddReminder}
        className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg py-2.5 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors">
        <Plus className="w-4 h-4" /> Agregar recordatorio
      </button>
    </Card>
  );
}

export default function CalendarioPage() {
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [statements, setStatements] = useState<StatementCal[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  // Starts on today: the day the user is standing on is the one they came to
  // check, and leaving the panel empty until they click somewhere hides it.
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());
  const [showAddReminder, setShowAddReminder] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const year = month.getFullYear();
    const m = month.getMonth() + 1;
    const [stRes, remRes] = await Promise.allSettled([
      api.get("/credit-cards/statements/calendar", { params: { year, month: m } }),
      api.get("/reminders", { params: { year, month: m } }),
    ]);
    setStatements(stRes.status === "fulfilled" ? stRes.value.data : []);
    setReminders(remRes.status === "fulfilled" ? remRes.value.data : []);
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

  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  function eventsForDay(day: Date): DayEvent[] {
    const events: DayEvent[] = [];
    for (const s of statements) {
      if (s.closing_date && isSameDay(parseISO(s.closing_date), day)) {
        events.push({ kind: "closing", label: `Cierre ${s.card_alias}`, amount: s.total });
      }
      if (s.due_date && isSameDay(parseISO(s.due_date), day)) {
        events.push({ kind: "due", label: `Vencimiento ${s.card_alias}`, amount: s.total });
      }
    }
    for (const r of reminders) {
      if (isSameDay(parseISO(r.remind_date), day)) {
        events.push({ kind: "reminder", label: r.title, reminder: r });
      }
    }
    return events;
  }

  async function handleAddReminder(title: string, dateStr: string) {
    await api.post("/reminders", { title, remind_date: dateStr });
    setShowAddReminder(false);
    // Stay on the day it was added to: the reminder shows up in the panel
    // underneath, which is the confirmation that it landed.
    setSelectedDay(parseISO(dateStr));
    await load();
  }

  async function handleDeleteReminder(id: number) {
    await api.delete(`/reminders/${id}`);
    await load();
  }

  const selectedEvents = eventsForDay(selectedDay);

  return (
    <div className="max-w-4xl space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-2xl font-display font-bold text-foreground">Calendario de pagos</h1>
      </div>

      <Card variant="hero" className="p-3 md:p-4">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setMonth(subMonths(month, 1))} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <p className="font-semibold text-foreground capitalize">{format(month, "MMMM yyyy", { locale: es })}</p>
          <button onClick={() => setMonth(addMonths(month, 1))} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAYS.map((d) => (
            <div key={d} className="text-center text-xs font-medium text-muted-foreground/70 py-1">{d}</div>
          ))}
        </div>

        <div className={cn("grid grid-cols-7 gap-1", loading && "opacity-50")}>
          {days.map((day) => {
            const events = eventsForDay(day);
            const inMonth = isSameMonth(day, month);
            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDay(day)}
                className={cn(
                  "aspect-square rounded-lg p-1 flex flex-col items-center justify-start text-xs border-2 transition-colors",
                  inMonth ? "bg-card hover:bg-accent" : "bg-muted text-muted-foreground/40",
                  // Selected wins over today: today is where you start, the
                  // selection is where you're looking.
                  isSameDay(day, selectedDay) ? "border-ink bg-accent"
                    : isToday(day) ? "border-primary" : "border-transparent"
                )}
              >
                <span className={cn("mb-0.5", isToday(day) && "font-bold text-primary")}>{format(day, "d")}</span>
                {events.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 justify-center">
                    {events.slice(0, 4).map((ev, i) => (
                      <span key={i} className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        ev.kind === "closing" ? "bg-orange-400" :
                        ev.kind === "due" ? "bg-rose-400" : "bg-primary"
                      )} />
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-4 mt-4 pt-3 border-t text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-400" /> Cierre</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-400" /> Vencimiento</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-primary" /> Recordatorio</span>
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
