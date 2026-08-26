"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { KeyRound, Plug, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Card } from "@/components/ui/card";
import { FIELD, SelectField } from "@/components/ui/form";
import { Chip } from "@/components/ui/chip";

interface Connection {
  grant_id: string;
  client_name: string;
  scopes: string[];
  connected_at: string | null;
  last_used_at: string | null;
}

interface PersonalToken {
  id: number;
  name: string | null;
  token_prefix: string;
  created_at: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  expired: boolean;
}

interface CreatedToken {
  token: string;
  name: string | null;
  expires_at: string | null;
}


const EXPIRY_OPTIONS = [
  { value: "30", label: "30 días" },
  { value: "90", label: "90 días" },
  { value: "365", label: "1 año" },
  { value: "never", label: "Sin vencimiento" },
];

function relative(iso: string | null): string {
  if (!iso) return "nunca";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `hace ${days} día${days === 1 ? "" : "s"}`;
  return new Date(iso).toLocaleDateString("es-AR");
}

function shortDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("es-AR") : "—";
}

export default function McpConnectorSection() {
  const [connectorUrl, setConnectorUrl] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [tokens, setTokens] = useState<PersonalToken[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("90");
  // Shown once, right after creation, and never persisted anywhere.
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [confirmId, setConfirmId] = useState<string | number | null>(null);

  const load = () => {
    api
      .get<{ connections: Connection[]; connector_url: string }>("/oauth/connections")
      .then(res => {
        setConnections(res.data.connections);
        setConnectorUrl(res.data.connector_url);
      })
      .catch(e => setError(getErrorMessage(e)));
    api
      .get<{ tokens: PersonalToken[] }>("/oauth/tokens")
      .then(res => setTokens(res.data.tokens))
      .catch(e => setError(getErrorMessage(e)));
  };

  useEffect(load, []);

  const createToken = async () => {
    setBusy(true);
    try {
      const res = await api.post<CreatedToken>("/oauth/tokens", {
        name: name.trim() || "Token sin nombre",
        expires_in_days: expiry === "never" ? null : Number(expiry),
      });
      setCreated(res.data);
      setName("");
      setShowForm(false);
      setError(null);
      load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const revokeToken = async (id: number) => {
    setBusy(true);
    try {
      await api.delete(`/oauth/tokens/${id}`);
      setConfirmId(null);
      load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (grantId: string) => {
    setBusy(true);
    try {
      await api.delete(`/oauth/connections/${grantId}`);
      setConfirmId(null);
      load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmRow = (id: string | number, onConfirm: () => void) =>
    confirmId === id ? (
      <div className="flex items-center gap-1">
        <button
          onClick={onConfirm}
          disabled={busy}
          className="text-xs bg-destructive text-destructive-foreground px-2 py-1 rounded disabled:opacity-50"
        >
          {busy ? "..." : "Confirmar"}
        </button>
        <button
          onClick={() => setConfirmId(null)}
          className="text-xs border px-2 py-1 rounded text-muted-foreground hover:bg-accent"
        >
          Cancelar
        </button>
      </div>
    ) : (
      <button
        onClick={() => setConfirmId(id)}
        className="text-destructive/60 hover:text-destructive transition-colors"
        title="Revocar acceso"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    );

  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Plug className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-foreground">Conectar con una IA</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Conectá RegistrApp a un asistente de IA para preguntarle sobre tus gastos, tus
        ingresos o el impacto de una compra. El asistente puede{" "}
        <strong className="text-foreground">leer</strong> los datos de tu hogar, pero
        nunca modificarlos ni borrarlos.
      </p>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Dirección del conector</p>
        <div className="flex items-center gap-2">
          {/* An input, not a <code> block: `break-all` wrapped the URL across
              lines and a copy from the rendered text dragged those breaks with
              it. One line that scrolls, read-only, and copying takes the value
              from the field rather than from the selection. */}
          <input
            readOnly
            value={connectorUrl || "—"}
            onFocus={e => e.currentTarget.select()}
            aria-label="Dirección del conector"
            className="flex-1 min-w-0 bg-muted border-2 border-ink rounded-lg px-3 py-2 text-xs font-mono text-foreground truncate"
          />
          {connectorUrl && <CopyButton value={connectorUrl} />}
        </div>
        <p className="text-xs text-muted-foreground">
          Agregala en tu asistente como conector personalizado. Te va a pedir iniciar
          sesión para autorizarlo.
        </p>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-foreground">Apps conectadas</h4>
        {connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no conectaste ninguna app.</p>
        ) : (
          <div className="divide-y">
            {connections.map(c => (
              <div key={c.grant_id} className="flex items-center justify-between py-3 gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{c.client_name}</p>
                  <p className="text-xs text-muted-foreground">Conectada el {shortDate(c.connected_at)}</p>
                  <p className="text-xs text-muted-foreground">Último uso {relative(c.last_used_at)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Chip tone="emerald">Solo lectura</Chip>
                  {confirmRow(c.grant_id, () => disconnect(c.grant_id))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5" />
            Token
          </h4>
          {!showForm && (
            <Button variant="outline" onClick={() => setShowForm(true)}>
              Crear token
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Para los asistentes que piden una clave en vez de iniciar sesión.
        </p>

        {showForm && (
          <div className="space-y-2 border rounded-lg p-3">
            <input
              className={FIELD}
              placeholder="Nombre (ej. asistente de la notebook)"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={100}
            />
            <SelectField value={expiry} onChange={setExpiry}
              options={EXPIRY_OPTIONS.map(o => ({ value: o.value, label: `Vence en ${o.label.toLowerCase()}` }))} />
            <div className="flex gap-2">
              <Button onClick={createToken} disabled={busy}>
                {busy ? "Creando..." : "Crear"}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {created && (
          <div className="border-2 border-ink rounded-lg p-3 space-y-2 bg-amber-50">
            <p className="text-sm font-semibold text-foreground">
              Guardá este token ahora: no vas a poder verlo de nuevo.
            </p>
            <code className="block bg-white border rounded px-3 py-2 text-xs font-mono break-all">
              {created.token}
            </code>
            <div className="flex gap-2">
              <CopyButton value={created.token} label="Copiar token" />
              <Button variant="outline" onClick={() => setCreated(null)}>
                Ya lo guardé
              </Button>
            </div>
          </div>
        )}

        {tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no creaste ninguno.</p>
        ) : (
          <div className="divide-y">
            {tokens.map(t => (
              <div key={t.id} className="flex items-center justify-between py-3 gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">
                    {t.name || "Sin nombre"}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">{t.token_prefix}…</p>
                  <p className="text-xs text-muted-foreground">
                    {t.expires_at ? `Vence el ${shortDate(t.expires_at)}` : "Sin vencimiento"} ·
                    último uso {relative(t.last_used_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {t.expired && <Chip tone="rose">Vencido</Chip>}
                  {confirmRow(t.id, () => revokeToken(t.id))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </Card>
  );
}
