"use client";

import { useState } from "react";
import { AtSign, Check, Copy, Pencil } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { FIELD, FormGrid } from "@/components/ui/form";
import { FORM_SHEET_BODY, FORM_SHEET_FORM, FormSheet, FormSheetActions } from "@/components/movimientos/FormSheet";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { suggestAlias } from "@/lib/alias";
import { useAuth } from "@/contexts/AuthContext";
import { isBusiness, roleLabel, terms } from "@/lib/account";

/**
 * Tus datos: nombre, apellido, alias y el nombre del hogar.
 *
 * La tarjeta sólo muestra; editar abre una hoja. Un formulario siempre abierto
 * invita a tocar campos sin querer, y estos tres se usan en lugares donde un
 * cambio se nota: el alias es por el que te encuentran, y el nombre es el que
 * queda escrito en cada gasto compartido.
 */

// El nombre del hogar es del hogar, no tuyo: lo cambia un admin y lo ve todo el
// mundo. Por eso va en la misma hoja pero por un endpoint aparte.
function EditProfileModal({ onClose }: { onClose: () => void }) {
  const { appUser, refreshUser } = useAuth();
  const isAdmin = appUser?.role === "admin";

  const [firstName, setFirstName] = useState(appUser?.first_name || "");
  const [lastName, setLastName] = useState(appUser?.last_name || "");
  const [alias, setAlias] = useState(appUser?.alias || "");
  const [tenantName, setTenantName] = useState(appUser?.tenant_name || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const reaccionar = useReaccion();

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError("");
    try {
      await api.patch("/auth/me", {
        first_name: firstName,
        last_name: lastName,
        alias: alias.trim(),
      });
      if (isAdmin && tenantName.trim()) {
        await api.patch("/auth/tenant", { name: tenantName.trim() });
      }
      await refreshUser();
      reaccionar("guardado", "Datos guardados");
      onClose();
    } catch (err: unknown) {
      // El backend distingue 409 (alias tomado) de 400 (inválido) justamente
      // para que acá se lean distinto: sólo el primero se arregla probando otro.
      setError(getErrorMessage(err, "No se pudo guardar"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSheet title="Editar tus datos" onClose={onClose}>
      <form onSubmit={save} className={FORM_SHEET_FORM}>
        <div className={FORM_SHEET_BODY}>
          <FormGrid>
            <div>
              <label htmlFor="profile-first" className="text-xs font-medium text-muted-foreground">Nombre</label>
              <input id="profile-first" className={FIELD} value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Agustín" />
            </div>
            <div>
              <label htmlFor="profile-last" className="text-xs font-medium text-muted-foreground">Apellido</label>
              <input id="profile-last" className={FIELD} value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Mercadal" />
            </div>
          </FormGrid>

          <div>
            <label htmlFor="profile-alias" className="text-xs font-medium text-muted-foreground">Alias</label>
            <div className="relative">
              <AtSign className="w-4 h-4 text-muted-foreground absolute left-3 top-[calc(50%+2px)] -translate-y-1/2 pointer-events-none" />
              <input
                id="profile-alias"
                className={`${FIELD} pl-9`}
                value={alias}
                onChange={e => setAlias(e.target.value.toLowerCase())}
                placeholder={suggestAlias(firstName, lastName) || "tu.alias"}
                maxLength={30}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <p className="text-xs text-[#4A4658] mt-1">Con esto te encuentran para compartirte un gasto.</p>
          </div>

          <div>
            <label htmlFor="profile-tenant" className="text-xs font-medium text-muted-foreground">Nombre del {terms(appUser).space}</label>
            <input
              id="profile-tenant"
              className={`${FIELD} disabled:opacity-60`}
              value={tenantName}
              onChange={e => setTenantName(e.target.value)}
              placeholder={isAdmin
                ? (isBusiness(appUser) ? "Ej: Rotisería Don Pepe" : "Ej: Casa García")
                : "Sólo un administrador puede cambiarlo"}
              disabled={!isAdmin}
            />
            {!isAdmin && (
              <p className="text-xs text-[#4A4658] mt-1">
                Sólo un administrador del {terms(appUser).space} puede cambiarlo.
              </p>
            )}
          </div>

          {error && <p role="alert" className="text-sm text-rose-800 bg-rose-50 rounded-xl px-3 py-2">{error}</p>}
        </div>
        <FormSheetActions onCancel={onClose} saving={saving} label="Guardar" />
      </form>
    </FormSheet>
  );
}

export function ProfileSection() {
  const { appUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!appUser) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(appUser.alias || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[22px] font-medium leading-tight tracking-[-0.03em] text-foreground truncate">
            {appUser.display_name || "Sin nombre"}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground truncate">{appUser.email}</p>
          <p className="text-sm text-muted-foreground">Rol: {roleLabel(appUser, appUser.role ?? "")}</p>
        </div>
        <button type="button" onClick={() => setEditing(true)} aria-label="Editar tus datos" title="Editar tus datos"
          className="w-11 h-11 shrink-0 -mt-1 -mr-1 rounded-full bg-ink/[0.05] text-foreground flex items-center justify-center active:scale-[0.95] transition-transform duration-100">
          <Pencil className="w-[18px] h-[18px]" strokeWidth={1.8} />
        </button>
      </div>

      {appUser.alias ? (
        <button type="button" onClick={copy}
          aria-label={copied ? "Alias copiado" : "Copiar alias"} title={copied ? "Copiado" : "Copiar al portapapeles"}
          className="mt-3 min-h-[40px] inline-flex items-center gap-2 max-w-full rounded-full bg-accent border border-[#CFC9E4] px-3.5 text-sm font-semibold text-[#3B2FB3] active:scale-[0.97] transition-transform duration-100">
          <span className="truncate">@{appUser.alias}</span>
          {copied ? <Check className="w-4 h-4 shrink-0" /> : <Copy className="w-4 h-4 shrink-0" />}
        </button>
      ) : (
        <button type="button" onClick={() => setEditing(true)}
          className="mt-3 min-h-[40px] inline-flex items-center rounded-full border border-dashed border-muted-foreground/50 px-3.5 text-sm font-semibold text-muted-foreground active:scale-[0.97] transition-transform duration-100">
          Elegí un alias
        </button>
      )}

      {editing && <EditProfileModal onClose={() => setEditing(false)} />}
    </Card>
  );
}
