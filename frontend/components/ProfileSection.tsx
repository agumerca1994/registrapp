"use client";

import { useEffect, useState } from "react";
import { AtSign, CheckCircle2, Copy, User as UserIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FIELD } from "@/components/ui/form";
import api from "@/lib/api";
import { foldText, getErrorMessage } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Tu perfil: nombre y alias.
 *
 * El alias es el equivalente al de una transferencia bancaria — algo corto que
 * podés decir en voz alta o pegar en un chat para que te compartan un gasto sin
 * que tengan que saber tu mail ni tu teléfono.
 *
 * No se autogenera a propósito: un alias asignado solo es un alias que nadie
 * sabe que tiene, y entonces nunca se dice ni se pega, que era todo el punto.
 * En cambio el campo viene **pre-llenado con una sugerencia** derivada del
 * nombre, que se acepta con un toque.
 */

// Del nombre al alias: sin acentos (`foldText`), espacios en puntos, y afuera
// todo lo que el backend no acepta.
function suggestAlias(displayName: string | null | undefined, email: string): string {
  const base = (displayName || email.split("@")[0] || "").trim();
  const s = foldText(base)
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._]/g, "")
    .replace(/[._]{2,}/g, ".")
    .replace(/^[^a-z]+/, "")
    .replace(/[._]+$/, "");
  return s.length >= 4 ? s.slice(0, 30) : "";
}

export function ProfileSection() {
  const { appUser, refreshUser } = useAuth();
  const [name, setName] = useState("");
  const [alias, setAlias] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!appUser) return;
    setName(appUser.display_name || "");
    setAlias(appUser.alias || suggestAlias(appUser.display_name, appUser.email));
  }, [appUser]);

  if (!appUser) return null;

  const dirty = name !== (appUser.display_name || "") || alias !== (appUser.alias || "");

  const save = async () => {
    setSaving(true); setError(""); setSaved(false);
    try {
      await api.patch("/auth/me", { display_name: name, alias });
      await refreshUser();
      setSaved(true);
    } catch (e: unknown) {
      // El backend distingue 409 (tomado) de 400 (inválido) justamente para
      // que acá se lean distinto: sólo el primero se arregla probando otro.
      setError(getErrorMessage(e, "No se pudo guardar"));
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(appUser.alias || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Card className="p-6 space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <UserIcon className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-foreground">Tu perfil</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Tu alias es como el de una transferencia: alcanza con pasarlo para que
          te compartan un gasto, sin dar tu mail ni tu teléfono.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Nombre</label>
          <input
            className={FIELD}
            value={name}
            onChange={e => { setName(e.target.value); setSaved(false); }}
            placeholder="Cómo te ven los demás"
            maxLength={120}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Alias</label>
          <div className="relative">
            <AtSign className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              className={`${FIELD} pl-9`}
              value={alias}
              onChange={e => { setAlias(e.target.value.toLowerCase()); setSaved(false); }}
              placeholder="tu.alias"
              maxLength={30}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Entre 4 y 30 caracteres: letras, números, puntos y guiones bajos.
          </p>
        </div>
      </div>

      {error && (
        <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Button onClick={save} disabled={saving || !dirty}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
        {appUser.alias && (
          <button
            onClick={copy}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <Copy className="w-3.5 h-3.5" />
            {copied ? "¡Copiado!" : `Copiar @${appUser.alias}`}
          </button>
        )}
        {saved && !dirty && (
          <span className="flex items-center gap-1.5 text-sm text-emerald-600">
            <CheckCircle2 className="w-4 h-4" /> Guardado
          </span>
        )}
      </div>
    </Card>
  );
}
