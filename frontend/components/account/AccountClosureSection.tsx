"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { roleLabel, terms } from "@/lib/account";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FIELD } from "@/components/ui/form";

// Pausar y eliminar la cuenta (backend: services/account_closure.py).
// Pausar congela sólo a esta persona y se deshace al iniciar sesión. Eliminar es definitivo: los datos quedan
// ilegibles para siempre, por eso pide escribir la palabra y no alcanza con un toque.

const CONFIRM_WORD = "eliminar";

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <Card className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-foreground flex-1">{title}</h3>
          <button onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </Card>
    </div>
  );
}

/** `othersRemain`: si quedan otras personas en el hogar o negocio. `null` cuando no se sabe (un empleado no ve la
 *  lista de miembros). */
export function AccountClosureSection({ othersRemain }: { othersRemain: boolean | null }) {
  const { appUser, refreshUser, logout } = useAuth();
  const t = terms(appUser);
  const [open, setOpen] = useState<"pause" | "delete" | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => { if (busy) return; setOpen(null); setConfirm(""); setError(null); };

  const pause = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/me/pause");
      // El layout ve `paused_at` y muestra la pantalla de cuenta en pausa.
      await refreshUser();
    } catch (err) {
      setError(getErrorMessage(err));
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/me/delete", { confirm });
    } catch (err) {
      setError(getErrorMessage(err));
      setBusy(false);
      return;
    }
    await logout().catch(() => {});
    window.location.href = "/";
  };

  return (
    <Card className="p-6 space-y-3">
      <h3 className="font-semibold text-foreground">Tu cuenta</h3>
      <div className="space-y-0.5">
        <p className="text-sm text-foreground">{appUser?.display_name || "Sin nombre"}</p>
        <p className="text-sm text-muted-foreground">{appUser?.email}</p>
        <p className="text-xs text-muted-foreground">Rol: {roleLabel(appUser, appUser?.role ?? "")}</p>
      </div>
      <div className="pt-3 border-t flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => setOpen("pause")}>Pausar mi cuenta</Button>
        <button onClick={() => setOpen("delete")}
          className="text-sm font-medium text-destructive hover:underline px-1 py-2">
          Eliminar mi cuenta
        </button>
      </div>

      {open === "pause" && (
        <Modal title="Pausar tu cuenta" onClose={close}>
          <div className="space-y-2 text-sm text-foreground leading-relaxed">
            <p>
              Mientras esté en pausa no vas a poder entrar a tood ni cargar nada por WhatsApp, tu asistente de IA no
              va a poder leer tus datos y no te va a llegar ningún aviso.
            </p>
            <p>No se borra nada. Cuando quieras volver, iniciás sesión y tocás <strong>Reactivar</strong>.</p>
            {othersRemain && (
              <p className="text-muted-foreground">Las demás personas de {t.yourSpace} lo siguen usando como siempre.</p>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={close} disabled={busy}>Cancelar</Button>
            <Button onClick={pause} disabled={busy}>{busy ? "Pausando…" : "Pausar"}</Button>
          </div>
        </Modal>
      )}

      {open === "delete" && (
        <Modal title="Eliminar tu cuenta" onClose={close}>
          <div className="space-y-2 text-sm text-foreground leading-relaxed">
            <p className="font-semibold">Es definitivo y no se puede deshacer.</p>
            <ul className="list-disc pl-5 space-y-1.5">
              {othersRemain ? (
                <>
                  <li>Tu nombre, alias, mail y teléfono quedan ilegibles y salís de {t.yourSpace}.</li>
                  <li>Lo que cargaste se queda en {t.yourSpace} para las demás personas.</li>
                </>
              ) : (
                <li>
                  Todo lo que cargaste (descripciones, notas, categorías, tarjetas, contactos) queda ilegible, junto con
                  tu nombre, alias, mail y teléfono. Nadie lo puede recuperar, tampoco nosotros.
                </li>
              )}
              <li>Se cierra tu sesión en todos tus dispositivos y se desconecta tu asistente de IA.</li>
            </ul>
            {othersRemain === null && (
              <p className="text-muted-foreground">
                Si quedan otras personas en {t.yourSpace}, lo cargado se queda con ellas.
              </p>
            )}
            <p className="text-muted-foreground">Si sólo querés dejar de usarla un tiempo, pausala.</p>
          </div>
          <label className="block space-y-1.5">
            <span className="text-sm text-foreground">Escribí <strong>{CONFIRM_WORD}</strong> para confirmar</span>
            <input className={FIELD} value={confirm} onChange={e => setConfirm(e.target.value)}
              autoComplete="off" autoCapitalize="none" spellCheck={false} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={close} disabled={busy}>Cancelar</Button>
            <Button variant="destructive" onClick={remove}
              disabled={busy || confirm.trim().toLowerCase() !== CONFIRM_WORD}>
              {busy ? "Eliminando…" : "Eliminar definitivamente"}
            </Button>
          </div>
        </Modal>
      )}
    </Card>
  );
}
