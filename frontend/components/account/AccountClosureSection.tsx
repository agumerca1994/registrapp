"use client";

import { useState } from "react";
import { PauseCircle, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { terms } from "@/lib/account";
import { FIELD } from "@/components/ui/form";
import { FORM_SHEET_BODY, FORM_SHEET_FORM, FormSheet, FormSheetActions } from "@/components/movimientos/FormSheet";
import { SettingsRow } from "@/components/settings/SettingsParts";

// Pausar y eliminar la cuenta (backend: services/account_closure.py).
// Pausar congela sólo a esta persona y se deshace al iniciar sesión. Eliminar es definitivo: los datos quedan
// ilegibles para siempre, por eso pide escribir la palabra y no alcanza con un toque.

const CONFIRM_WORD = "eliminar";

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

  const pause = async (e: React.FormEvent) => {
    e.preventDefault();
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

  const remove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (confirm.trim().toLowerCase() !== CONFIRM_WORD) return;
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

  const errorLine = error && <p role="alert" className="text-sm text-rose-800 bg-rose-50 rounded-xl px-3 py-2">{error}</p>;

  return (
    <>
      <SettingsRow icon={PauseCircle} title="Pausar mi cuenta" hint="Se congela hasta que vuelvas. No se borra nada."
        onClick={() => setOpen("pause")} />
      <SettingsRow icon={Trash2} danger title="Eliminar mi cuenta" hint="Es definitivo."
        onClick={() => setOpen("delete")} />

      {open === "pause" && (
        <FormSheet title="Pausar tu cuenta" onClose={close}>
          <form onSubmit={pause} className={FORM_SHEET_FORM}>
            <div className={FORM_SHEET_BODY}>
              <div className="space-y-2 px-1.5 text-[15px] text-foreground leading-relaxed">
                <p>
                  Mientras esté en pausa no vas a poder entrar a tood ni cargar nada por WhatsApp, tu asistente de IA no
                  va a poder leer tus datos y no te va a llegar ningún aviso.
                </p>
                <p>No se borra nada. Cuando quieras volver, iniciás sesión y tocás <strong>Reactivar</strong>.</p>
                {othersRemain && (
                  <p className="text-[#4A4658]">Las demás personas de {t.yourSpace} lo siguen usando como siempre.</p>
                )}
              </div>
              {errorLine}
            </div>
            <FormSheetActions onCancel={close} saving={false} disabled={busy} label={busy ? "Pausando…" : "Pausar"} />
          </form>
        </FormSheet>
      )}

      {open === "delete" && (
        <FormSheet title="Eliminar tu cuenta" onClose={close}>
          <form onSubmit={remove} className={FORM_SHEET_FORM}>
            <div className={FORM_SHEET_BODY}>
              <div className="space-y-2 px-1.5 text-[15px] text-foreground leading-relaxed">
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
                  <p className="text-[#4A4658]">
                    Si quedan otras personas en {t.yourSpace}, lo cargado se queda con ellas.
                  </p>
                )}
                <p className="text-[#4A4658]">Si sólo querés dejar de usarla un tiempo, pausala.</p>
              </div>
              <label className="block px-1.5">
                <span className="text-sm text-foreground">Escribí <strong>{CONFIRM_WORD}</strong> para confirmar</span>
                <input className={FIELD} value={confirm} onChange={e => setConfirm(e.target.value)}
                  autoComplete="off" autoCapitalize="none" spellCheck={false} />
              </label>
              {errorLine}
            </div>
            {/* Como `FormSheetActions`, pero en rojo: es la única acción de la app que borra una cuenta. */}
            <div className="shrink-0 flex items-center gap-2 px-3.5 pt-2.5 pb-3.5 border-t border-ink/[0.08]">
              <button type="button" onClick={close} disabled={busy}
                className="h-[52px] px-4 rounded-full font-semibold text-[15px] text-foreground disabled:opacity-50 active:scale-[0.98] transition-transform duration-100">
                Cancelar
              </button>
              <button type="submit" disabled={busy || confirm.trim().toLowerCase() !== CONFIRM_WORD}
                className="flex-1 h-[52px] rounded-full bg-destructive text-destructive-foreground font-semibold text-[15px] disabled:opacity-50 active:scale-[0.98] transition-transform duration-100">
                {busy ? "Eliminando…" : "Eliminar definitivamente"}
              </button>
            </div>
          </form>
        </FormSheet>
      )}
    </>
  );
}
