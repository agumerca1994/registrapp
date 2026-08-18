"use client";

import { useState } from "react";
import { AtSign, Copy, Home, Pencil, User as UserIcon, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FIELD, FormGrid } from "@/components/ui/form";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { suggestAlias } from "@/lib/alias";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Tus datos: nombre, apellido, alias y el nombre del hogar.
 *
 * La tarjeta sólo muestra; editar abre un modal. Un formulario siempre abierto
 * en una pantalla que es casi toda formularios invita a tocar campos sin
 * querer, y estos tres se usan en lugares donde un cambio se nota: el alias es
 * por el que te encuentran, y el nombre es el que queda escrito en cada gasto
 * compartido.
 */

// El nombre del hogar es del hogar, no tuyo: lo cambia un admin y lo ve todo el
// mundo. Por eso va en el mismo modal pero por un endpoint aparte.
function EditProfileModal({ onClose }: { onClose: () => void }) {
  const { appUser, refreshUser } = useAuth();
  const isAdmin = appUser?.role === "admin";

  const [firstName, setFirstName] = useState(appUser?.first_name || "");
  const [lastName, setLastName] = useState(appUser?.last_name || "");
  const [alias, setAlias] = useState(appUser?.alias || "");
  const [tenantName, setTenantName] = useState(appUser?.tenant_name || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
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
      onClose();
    } catch (e: unknown) {
      // El backend distingue 409 (alias tomado) de 400 (inválido) justamente
      // para que acá se lean distinto: sólo el primero se arregla probando otro.
      setError(getErrorMessage(e, "No se pudo guardar"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Editar tus datos"
    >
      <Card
        className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-foreground flex-1">Editar tus datos</h3>
          <button onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <FormGrid>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Nombre</label>
            <input className={FIELD} value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Agustín" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Apellido</label>
            <input className={FIELD} value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Mercadal" />
          </div>
        </FormGrid>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Alias</label>
          <div className="relative">
            <AtSign className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
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
          <p className="text-xs text-muted-foreground mt-1">
            Con esto te encuentran para compartirte un gasto.
          </p>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Nombre del hogar</label>
          <input
            className={FIELD}
            value={tenantName}
            onChange={e => setTenantName(e.target.value)}
            placeholder={isAdmin ? "Ej: Casa García" : "Sólo un administrador puede cambiarlo"}
            disabled={!isAdmin}
          />
          {!isAdmin && (
            <p className="text-xs text-muted-foreground mt-1">
              Sólo un administrador del hogar puede cambiarlo.
            </p>
          )}
        </div>

        {error && (
          <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" onClick={save} disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </Card>
    </div>
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
    <Card className="p-6 space-y-4">
      <div className="flex items-start gap-2">
        <UserIcon className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground">Tus datos</h3>
          <p className="text-sm text-muted-foreground">
            Tu alias es como el de una transferencia: alcanza con pasarlo para
            que te compartan un gasto.
          </p>
        </div>
        <button
          onClick={() => setEditing(true)}
          className="flex items-center gap-1.5 text-sm text-primary hover:underline shrink-0"
        >
          <Pencil className="w-3.5 h-3.5" /> Editar
        </button>
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex items-baseline gap-3">
          <dt className="text-muted-foreground w-24 shrink-0">Nombre</dt>
          <dd className="text-foreground font-medium min-w-0 truncate">
            {appUser.display_name || <span className="text-muted-foreground font-normal">Sin completar</span>}
          </dd>
        </div>
        <div className="flex items-baseline gap-3">
          <dt className="text-muted-foreground w-24 shrink-0">Alias</dt>
          <dd className="text-foreground font-medium min-w-0 truncate flex items-baseline gap-2">
            {appUser.alias ? (
              <>
                @{appUser.alias}
                <button onClick={copy} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                  <Copy className="w-3 h-3" /> {copied ? "¡Copiado!" : "Copiar"}
                </button>
              </>
            ) : (
              <span className="text-muted-foreground font-normal">Sin elegir</span>
            )}
          </dd>
        </div>
        <div className="flex items-baseline gap-3">
          <dt className="text-muted-foreground w-24 shrink-0 flex items-center gap-1">
            <Home className="w-3 h-3" /> Hogar
          </dt>
          <dd className="text-foreground font-medium min-w-0 truncate">
            {appUser.tenant_name || <span className="text-muted-foreground font-normal">Sin nombre</span>}
          </dd>
        </div>
      </dl>

      {editing && <EditProfileModal onClose={() => setEditing(false)} />}
    </Card>
  );
}
