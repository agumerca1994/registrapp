"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import api from "@/lib/api";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { getErrorMessage } from "@/lib/utils";
import { Plus, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateField, FieldLabel, FormGrid, MonthField } from "@/components/ui/form";
import { CurrentStatement, StatementPaper, type StatementData } from "@/components/StatementPaper";
import { BankLogo } from "@/components/ui/bank-logo";
import { features } from "@/lib/features";
import { UploadStatementButton } from "@/components/UploadStatementButton";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { MotionList } from "@/components/ui/motion-list";
import { FORM_SHEET_BODY, FORM_SHEET_FORM, FormSheet, FormSheetActions } from "@/components/movimientos/FormSheet";
import { DeleteChoiceSheet, ErrorNote, SubHeader } from "@/components/tarjetas/parts";

const MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

interface Card { id: number; bank: string; alias: string; last_4_digits?: string; }
type Statement = StatementData;

function NewStatementModal({ onSave, onClose }: {
  onSave: (year: number, month: number, closingDate: string, dueDate: string) => Promise<void>;
  onClose: () => void;
}) {
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [closingDate, setClosingDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const [year, month] = period.split("-").map(Number);
      await onSave(year, month, closingDate, dueDate);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "No se pudo crear el resumen"));
      setSaving(false);
    }
  };

  return (
    <FormSheet title="Crear resumen" onClose={onClose}>
      <form onSubmit={handleSubmit} className={FORM_SHEET_FORM}>
        <div className={FORM_SHEET_BODY}>
          <div>
            <FieldLabel>Mes del resumen</FieldLabel>
            <MonthField required value={period} onChange={setPeriod} />
          </div>
          <FormGrid>
            <div>
              <FieldLabel hint="(opcional)">Cierre</FieldLabel>
              <DateField value={closingDate} onChange={setClosingDate} />
            </div>
            <div>
              <FieldLabel hint="(opcional)">Vencimiento</FieldLabel>
              <DateField value={dueDate} onChange={setDueDate} />
            </div>
          </FormGrid>
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
        <FormSheetActions onCancel={onClose} saving={saving} label="Crear resumen" />
      </form>
    </FormSheet>
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
      setError(getErrorMessage(err, "No se pudieron guardar las fechas del resumen"));
      setSaving(false);
    }
  };

  return (
    <FormSheet title={`Fechas de ${MONTH_NAMES[statement.month - 1].toLowerCase()} ${statement.year}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className={FORM_SHEET_FORM}>
        <div className={FORM_SHEET_BODY}>
          <FormGrid>
            <div>
              <FieldLabel hint="(opcional)">Cierre</FieldLabel>
              <DateField value={closingDate} onChange={setClosingDate} />
            </div>
            <div>
              <FieldLabel hint="(opcional)">Vencimiento</FieldLabel>
              <DateField value={dueDate} onChange={setDueDate} />
            </div>
          </FormGrid>
          {/* Vaciar el vencimiento real no deja el resumen sin fecha: vuelve a la estimación. */}
          {!dueDate && statement.due_date_effective && (
            <p className="px-1 text-xs leading-snug text-muted-foreground">
              Sin vencimiento cargado, se estima con el día de vencimiento de la tarjeta.
            </p>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
        <FormSheetActions onCancel={onClose} saving={saving} label="Guardar" />
      </form>
    </FormSheet>
  );
}

/** Punteada, como todo lo que todavía no es un hecho: esos resúmenes son compromisos, no papeles que mandó el banco. */
function GroupToggle({ label, count, open, onToggle }: { label: string; count: number; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="w-full min-h-[52px] rounded-2xl border border-dashed border-border px-3.5 flex items-center gap-2.5 text-left active:scale-[0.99] transition-transform duration-100"
    >
      <ChevronRight className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
      <span className="text-[15px] font-medium text-foreground">{label}</span>
      <span className="font-marca text-xs text-muted-foreground">({count})</span>
    </button>
  );
}

export default function CardDetailPage() {
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const params = useParams();
  const router = useRouter();
  const reaccionar = useReaccion();
  const cardId = Number(params.cardId);
  const [card, setCard] = useState<Card | null>(null);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed" | "missing">("loading");
  const [showNewStmt, setShowNewStmt] = useState(false);
  const [deleteStmt, setDeleteStmt] = useState<Statement | null>(null);
  const [editStmt, setEditStmt] = useState<Statement | null>(null);
  const [showFuture, setShowFuture] = useState(false);
  // null = untouched, so the default can follow the data (see below).
  const [pastOpen, setPastOpen] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const [cardRes, stmtRes] = await Promise.all([
        api.get("/credit-cards"),
        api.get(`/credit-cards/${cardId}/statements`),
      ]);
      const found = (cardRes.data as Card[]).find((c) => c.id === cardId);
      setCard(found || null);
      setStatements(stmtRes.data);
      setLoadState(found ? "ready" : "missing");
    } catch {
      setLoadState("failed");
    }
  }, [cardId]);

  useEffect(() => { load(); }, [load]);

  const handleCreateStatement = async (year: number, month: number, closingDate: string, dueDate: string) => {
    await api.post(`/credit-cards/${cardId}/statements`, {
      year, month,
      closing_date: closingDate || null,
      due_date: dueDate || null,
    });
    reaccionar("guardado", "Resumen creado");
    setShowNewStmt(false);
    await load();
  };

  const handleDeleteStatement = async (keepExpenses: boolean) => {
    if (!deleteStmt) return;
    await api.delete(`/credit-cards/statements/${deleteStmt.id}?keep_expenses=${keepExpenses}`);
    reaccionar("borrado", "Resumen eliminado");
    setDeleteStmt(null);
    await load();
  };

  const handleUpdateStatement = async (closingDate: string, dueDate: string) => {
    if (!editStmt) return;
    await api.patch(`/credit-cards/statements/${editStmt.id}`, {
      closing_date: closingDate || null,
      due_date: dueDate || null,
    });
    reaccionar("guardado", "Fechas guardadas");
    setEditStmt(null);
    await load();
  };

  // Instalment propagation creates every future statement up front, and the
  // endpoint returns newest-first — so a 12-cuota purchase buries the month
  // the user actually came to see under eleven statements that only exist as
  // commitments. They collapse into one row; the current month is the cut, and
  // it stays visible.
  const now = new Date();
  const currentPeriod = now.getFullYear() * 12 + now.getMonth();
  const periodOf = (s: Statement) => s.year * 12 + (s.month - 1);
  const futureStatements = statements.filter((s) => periodOf(s) > currentPeriod);
  const currentStatements = statements.filter((s) => periodOf(s) === currentPeriod);
  const pastStatements = statements.filter((s) => periodOf(s) < currentPeriod);

  // With both groups closed the page is the current month and two rows — which
  // is the "one statement per card per month" view, without a month selector.
  // But a card can legitimately have no statement for the current month (the
  // bank hasn't closed it, or nothing was charged), and two collapsed rows over
  // an empty page reads as a screen that failed to load. So the past opens by
  // default in exactly that case; an explicit toggle always wins.
  const showPast = pastOpen ?? currentStatements.length === 0;

  if (loadState === "loading") {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="h-11 w-48 rounded-2xl bg-ink/[0.06] animate-pulse" />
        <div className="h-[132px] rounded-3xl bg-ink/[0.06] animate-pulse" />
        <span className="sr-only">Cargando la tarjeta</span>
      </div>
    );
  }

  if (loadState !== "ready" || !card) {
    return (
      <div className="px-2 py-6">
        <p className="text-[19px] font-medium tracking-[-0.02em] text-foreground">
          {loadState === "missing" ? "Esta tarjeta ya no está." : "No pudimos traer esta tarjeta."}
        </p>
        <p className="mt-1 text-[15px] text-muted-foreground">
          {loadState === "missing" ? "Puede que la hayan eliminado." : "Tus datos están bien. Fijate si tenés conexión y probá de nuevo."}
        </p>
        <div className="mt-3 flex gap-2">
          {loadState === "failed" && <Button className="h-11" onClick={() => { setLoadState("loading"); load(); }}>Probar de nuevo</Button>}
          <Button variant="outline" className="h-11" onClick={() => router.push("/tarjetas")}>Ir a Tarjetas</Button>
        </div>
      </div>
    );
  }

  const paperProps = (stmt: Statement) => ({
    statement: stmt,
    onClick: () => router.push(`/tarjetas/${cardId}/${stmt.id}`),
    onEdit: () => setEditStmt(stmt),
    onDelete: () => setDeleteStmt(stmt),
  });

  const detail = [card.alias !== card.bank ? card.bank : null, card.last_4_digits ? `•••• ${card.last_4_digits}` : null]
    .filter(Boolean).join(" · ");

  return (
    <div className="space-y-4 md:space-y-6">
      <SubHeader title={card.alias} sub={detail || undefined} backLabel="Volver a Tarjetas" backHref="/tarjetas"
        leading={<BankLogo bankName={card.bank} size={40} className="shrink-0 border border-border" />}>
        {features.reconcile && <UploadStatementButton cardId={card.id} />}
        <Button onClick={() => setShowNewStmt(true)} aria-label="Crear resumen" className="w-11 h-11 p-0 sm:w-auto sm:px-4">
          <Plus className="w-[18px] h-[18px] shrink-0" />
          <span className="hidden sm:inline">Crear resumen</span>
        </Button>
      </SubHeader>

      {statements.length === 0 ? (
        <div className="px-2 py-6 text-center">
          <p className="text-[19px] font-medium tracking-[-0.02em] text-foreground">Esta tarjeta todavía no tiene resúmenes.</p>
          <p className="mt-1 text-[15px] text-muted-foreground">Se crean solos cuando cargás un gasto con esta tarjeta. También podés crear uno a mano.</p>
          <Button className="mt-4 h-11" onClick={() => setShowNewStmt(true)}>Crear resumen</Button>
        </div>
      ) : (
        <MotionList className="space-y-3">
          {futureStatements.length > 0 && (
            <>
              <GroupToggle label="Próximos resúmenes" count={futureStatements.length} open={showFuture} onToggle={() => setShowFuture((v) => !v)} />
              {showFuture && (
                <MotionList className="px-2">
                  {futureStatements.map((stmt) => <StatementPaper key={stmt.id} {...paperProps(stmt)} />)}
                </MotionList>
              )}
            </>
          )}

          {currentStatements.map((stmt) => <CurrentStatement key={stmt.id} {...paperProps(stmt)} />)}

          {pastStatements.length > 0 && (
            <>
              <GroupToggle label="Resúmenes anteriores" count={pastStatements.length} open={showPast} onToggle={() => setPastOpen(!showPast)} />
              {showPast && (
                <MotionList className="px-2">
                  {pastStatements.map((stmt) => <StatementPaper key={stmt.id} {...paperProps(stmt)} />)}
                </MotionList>
              )}
            </>
          )}

          {/* The divider marks the end of the papers. While the past group is
              closed the history is right there behind the row above it, so
              announcing its end would be a lie. */}
          {(showPast || pastStatements.length === 0) && (
            <div className="flex items-center gap-3 pt-2">
              <div className="flex-1 border-t border-dashed border-border" />
              <p className="font-marca text-xs text-muted-foreground shrink-0">Fin del historial</p>
              <div className="flex-1 border-t border-dashed border-border" />
            </div>
          )}
        </MotionList>
      )}

      {showNewStmt && <NewStatementModal onSave={handleCreateStatement} onClose={() => setShowNewStmt(false)} />}
      {deleteStmt && (
        <DeleteChoiceSheet
          title="Eliminar resumen"
          intro={<>¿Qué pasa con los gastos del resumen de <strong className="font-semibold">{MONTH_NAMES[deleteStmt.month - 1].toLowerCase()} {deleteStmt.year}</strong>?</>}
          keep="Siguen en Egresos, ya sin el resumen."
          remove="Se borran de Egresos todos los gastos de este resumen."
          confirmLabel="Eliminar resumen"
          onConfirm={handleDeleteStatement}
          onClose={() => setDeleteStmt(null)}
        />
      )}
      {editStmt && <EditStatementModal statement={editStmt} onSave={handleUpdateStatement} onClose={() => setEditStmt(null)} />}
    </div>
  );
}
