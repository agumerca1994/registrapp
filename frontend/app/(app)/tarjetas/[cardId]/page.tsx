"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { Plus, ChevronLeft, X } from "lucide-react";
import { Card as UiCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatementPaper } from "@/components/StatementPaper";
import { BankLogo } from "@/components/ui/bank-logo";

const MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const INPUT = "mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-card text-foreground";

interface Card { id: number; bank: string; alias: string; last_4_digits?: string; }
interface StatementItem {
  id: number; description: string; item_date: string; item_type: string;
  amount: number; installment_count?: number; installment_number?: number;
  category: { id: number; name: string; color?: string };
}
interface Statement {
  id: number; card_id: number; year: number; month: number;
  closing_date?: string; due_date?: string; total: number; items: StatementItem[];
}
type DeleteMode = "keep" | "delete";

function DeleteStatementModal({ statement, onConfirm, onClose }: {
  statement: Statement; onConfirm: (mode: DeleteMode) => Promise<void>; onClose: () => void;
}) {
  const [mode, setMode] = useState<DeleteMode>("keep");
  const [deleting, setDeleting] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <UiCard className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Eliminar resumen</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-muted-foreground">
          ¿Qué hacemos con los gastos de <strong>{MONTH_NAMES[statement.month - 1]} {statement.year}</strong>?
        </p>
        <div className="space-y-2">
          <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-accent">
            <input type="radio" name="mode" value="keep" checked={mode === "keep"} onChange={() => setMode("keep")} className="mt-0.5" />
            <div><p className="text-sm font-medium text-foreground">Mantener los gastos</p><p className="text-xs text-muted-foreground">Quedan en Egresos sin el resumen</p></div>
          </label>
          <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-accent">
            <input type="radio" name="mode" value="delete" checked={mode === "delete"} onChange={() => setMode("delete")} className="mt-0.5" />
            <div><p className="text-sm font-medium text-foreground">Eliminar los gastos</p><p className="text-xs text-muted-foreground">Se borran todos los gastos de este resumen</p></div>
          </label>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button variant="destructive" onClick={async () => { setDeleting(true); await onConfirm(mode); setDeleting(false); }}
            disabled={deleting} className="flex-1">
            {deleting ? "Eliminando..." : "Eliminar"}
          </Button>
        </div>
      </UiCard>
    </div>
  );
}

function NewStatementModal({ onSave, onClose }: {
  onSave: (year: number, month: number, closingDate: string, dueDate: string) => Promise<void>;
  onClose: () => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [closingDate, setClosingDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await onSave(parseInt(year), parseInt(month), closingDate, dueDate);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Error al crear el resumen"));
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <UiCard className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Crear resumen</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Mes</label>
              <select className={INPUT} value={month} onChange={(e) => setMonth(e.target.value)}>
                {MONTH_NAMES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Año</label>
              <input type="number" className={INPUT} value={year} onChange={(e) => setYear(e.target.value)} required />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fecha de cierre</label>
              <input type="date" className={INPUT} value={closingDate} onChange={(e) => setClosingDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fecha de vencimiento</label>
              <input type="date" className={INPUT} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Creando..." : "Crear"}
            </Button>
          </div>
        </form>
      </UiCard>
    </div>
  );
}

function EditStatementModal({ statement, onSave, onClose }: {
  statement: Statement;
  onSave: (closingDate: string, dueDate: string) => Promise<void>;
  onClose: () => void;
}) {
  const [closingDate, setClosingDate] = useState(statement.closing_date || "");
  const [dueDate, setDueDate] = useState(statement.due_date || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await onSave(closingDate, dueDate);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Error al actualizar el resumen"));
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <UiCard className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">
            Editar {MONTH_NAMES[statement.month - 1]} {statement.year}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fecha de cierre</label>
              <input type="date" className={INPUT} value={closingDate} onChange={(e) => setClosingDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fecha de vencimiento</label>
              <input type="date" className={INPUT} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </form>
      </UiCard>
    </div>
  );
}

export default function CardDetailPage() {
  const params = useParams();
  const router = useRouter();
  const cardId = Number(params.cardId);
  const [card, setCard] = useState<Card | null>(null);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [showNewStmt, setShowNewStmt] = useState(false);
  const [deleteStmt, setDeleteStmt] = useState<Statement | null>(null);
  const [editStmt, setEditStmt] = useState<Statement | null>(null);

  const load = async () => {
    const [cardRes, stmtRes] = await Promise.all([
      api.get("/credit-cards"),
      api.get(`/credit-cards/${cardId}/statements`),
    ]);
    const found = (cardRes.data as Card[]).find((c) => c.id === cardId);
    setCard(found || null);
    setStatements(stmtRes.data);
  };

  useEffect(() => { load(); }, [cardId]);

  const handleCreateStatement = async (year: number, month: number, closingDate: string, dueDate: string) => {
    await api.post(`/credit-cards/${cardId}/statements`, {
      year, month,
      closing_date: closingDate || null,
      due_date: dueDate || null,
    });
    setShowNewStmt(false);
    await load();
  };

  const handleDeleteStatement = async (mode: DeleteMode) => {
    if (!deleteStmt) return;
    await api.delete(`/credit-cards/statements/${deleteStmt.id}?keep_expenses=${mode === "keep"}`);
    setDeleteStmt(null);
    await load();
  };

  const handleUpdateStatement = async (closingDate: string, dueDate: string) => {
    if (!editStmt) return;
    await api.patch(`/credit-cards/statements/${editStmt.id}`, {
      closing_date: closingDate || null,
      due_date: dueDate || null,
    });
    setEditStmt(null);
    await load();
  };

  if (!card) return <div className="p-6 text-sm text-muted-foreground">Cargando...</div>;

  return (
    <div className="max-w-4xl space-y-4 md:space-y-6">
      <div className="sticky top-0 z-10 bg-background pt-2 pb-3 -mx-4 px-4 md:-mx-8 md:px-8 flex items-center gap-3">
        <button onClick={() => router.push("/tarjetas")} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <BankLogo bankName={card.bank} size={36} className="shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="text-xl md:text-2xl font-display font-bold text-foreground truncate">{card.alias}</h2>
          <p className="text-sm text-muted-foreground">{card.bank}{card.last_4_digits ? ` •••• ${card.last_4_digits}` : ""}</p>
        </div>
        <Button onClick={() => setShowNewStmt(true)} className="shrink-0">
          <Plus className="w-4 h-4 shrink-0" />
          <span className="hidden sm:inline">Crear resumen</span>
        </Button>
      </div>

      {statements.length === 0 ? (
        <UiCard className="p-8 text-center text-muted-foreground">
          <p className="text-sm">No hay resúmenes para esta tarjeta.</p>
          <p className="text-xs mt-1">Creá el primer resumen mensual.</p>
        </UiCard>
      ) : (
        <div className="space-y-3">
          {statements.map((stmt) => (
            <StatementPaper
              key={stmt.id}
              statement={stmt}
              onClick={() => router.push(`/tarjetas/${cardId}/${stmt.id}`)}
              onEdit={() => setEditStmt(stmt)}
              onDelete={() => setDeleteStmt(stmt)}
            />
          ))}
          <div className="flex items-center gap-3 pt-2">
            <div className="flex-1 border-t border-dashed border-border" />
            <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide shrink-0">Fin del historial</p>
            <div className="flex-1 border-t border-dashed border-border" />
          </div>
        </div>
      )}

      {showNewStmt && <NewStatementModal onSave={handleCreateStatement} onClose={() => setShowNewStmt(false)} />}
      {deleteStmt && <DeleteStatementModal statement={deleteStmt} onConfirm={handleDeleteStatement} onClose={() => setDeleteStmt(null)} />}
      {editStmt && <EditStatementModal statement={editStmt} onSave={handleUpdateStatement} onClose={() => setEditStmt(null)} />}
    </div>
  );
}
