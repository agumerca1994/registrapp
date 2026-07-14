"use client";

import { useEffect, useState, useCallback } from "react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  isSameMonth, isSameDay, isToday, format, addMonths, subMonths, parseISO,
} from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, X, Trash2, Bell, CreditCard as CardIcon } from "lucide-react";

import api from "@/lib/api";
import { formatARS, cn, getErrorMessage } from "@/lib/utils";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const INPUT = "mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white text-gray-900";

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
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Nuevo recordatorio</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600">Texto *</label>
            <input required className={INPUT} placeholder="ej: Pagar tarjeta Visa"
              value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Fecha *</label>
            <input required type="date" className={INPUT}
              value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          </div>
          <p className="text-xs text-gray-400">
            Se te va a avisar por WhatsApp ese día (si tenés tu WhatsApp vinculado en Configuración).
          </p>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="border px-4 py-2 rounded-lg text-sm">Cancelar</button>
            <button type="submit" disabled={saving} className="bg-primary text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DayPanel({
  date, events, onClose, onAddReminder, onDeleteReminder,
}: {
  date: Date;
  events: DayEvent[];
  onClose: () => void;
  onAddReminder: () => void;
  onDeleteReminder: (id: number) => Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 capitalize">{format(date, "EEEE d 'de' MMMM", { locale: es })}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X className="w-5 h-5" /></button>
        </div>

        {events.length === 0 ? (
          <p className="text-sm text-gray-400">Sin eventos este día.</p>
        ) : (
          <div className="space-y-2">
            {events.map((ev, i) => (
              <div key={i} className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                ev.kind === "closing" ? "bg-orange-50 text-orange-700" :
                ev.kind === "due" ? "bg-red-50 text-red-700" :
                "bg-violet-50 text-violet-700"
              )}>
                {ev.kind === "reminder" ? <Bell className="w-4 h-4 shrink-0" /> : <CardIcon className="w-4 h-4 shrink-0" />}
                <span className="flex-1 min-w-0 truncate">{ev.label}</span>
                {ev.amount !== undefined && <span className="font-medium shrink-0">{formatARS(ev.amount)}</span>}
                {ev.kind === "reminder" && ev.reminder && (
                  <button onClick={() => onDeleteReminder(ev.reminder!.id)} className="text-violet-400 hover:text-red-500 shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <button onClick={onAddReminder}
          className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-lg py-2.5 text-sm text-gray-500 hover:border-primary hover:text-primary transition-colors">
          <Plus className="w-4 h-4" /> Agregar recordatorio
        </button>
      </div>
    </div>
  );
}

export default function CalendarioPage() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [statements, setStatements] = useState<StatementCal[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
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
    setSelectedDay(null);
    await load();
  }

  async function handleDeleteReminder(id: number) {
    await api.delete(`/reminders/${id}`);
    await load();
  }

  const selectedEvents = selectedDay ? eventsForDay(selectedDay) : [];

  return (
    <div className="max-w-4xl space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-2xl font-bold text-gray-900">Calendario de pagos</h1>
      </div>

      <div className="bg-white rounded-xl border p-3 md:p-4">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setMonth(subMonths(month, 1))} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <p className="font-semibold text-gray-900 capitalize">{format(month, "MMMM yyyy", { locale: es })}</p>
          <button onClick={() => setMonth(addMonths(month, 1))} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAYS.map((d) => (
            <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
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
                  "aspect-square rounded-lg p-1 flex flex-col items-center justify-start text-xs border transition-colors",
                  inMonth ? "bg-white hover:bg-gray-50" : "bg-gray-50 text-gray-300",
                  isToday(day) && "border-primary",
                  !isToday(day) && "border-transparent"
                )}
              >
                <span className={cn("mb-0.5", isToday(day) && "font-bold text-primary")}>{format(day, "d")}</span>
                {events.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 justify-center">
                    {events.slice(0, 4).map((ev, i) => (
                      <span key={i} className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        ev.kind === "closing" ? "bg-orange-400" :
                        ev.kind === "due" ? "bg-red-400" : "bg-violet-400"
                      )} />
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-4 mt-4 pt-3 border-t text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-400" /> Cierre</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400" /> Vencimiento</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-violet-400" /> Recordatorio</span>
        </div>
      </div>

      {selectedDay && !showAddReminder && (
        <DayPanel
          date={selectedDay}
          events={selectedEvents}
          onClose={() => setSelectedDay(null)}
          onAddReminder={() => setShowAddReminder(true)}
          onDeleteReminder={handleDeleteReminder}
        />
      )}
      {selectedDay && showAddReminder && (
        <AddReminderModal
          date={selectedDay}
          onSave={handleAddReminder}
          onClose={() => setShowAddReminder(false)}
        />
      )}
    </div>
  );
}
