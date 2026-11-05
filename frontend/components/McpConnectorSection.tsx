"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { siteHref } from "@/lib/site";
import { Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { FORM_SHEET_BODY, FormSheet } from "@/components/movimientos/FormSheet";
import { ConfirmInline, SettingsRow, SHEET_BLOCK, SHEET_NOTICE, SHEET_TEXT } from "@/components/settings/SettingsParts";
import { useAuth } from "@/contexts/AuthContext";
import { connectorScopeLabel, isBusiness } from "@/lib/account";
import { FIELD, SelectField } from "@/components/ui/form";
import { Chip } from "@/components/ui/chip";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { MotionList } from "@/components/ui/motion-list";

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
  return iso ? new Date(iso).toLocaleDateString("es-AR") : "";
}

export default function McpConnectorSection() {
  const { appUser } = useAuth();
  const business = isBusiness(appUser);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [connectorUrl, setConnectorUrl] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [tokens, setTokens] = useState<PersonalToken[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reaccionar = useReaccion();
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
        setLoaded(true);
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
      reaccionar("borrado", "Token revocado");
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
      reaccionar("borrado", "Conexión cerrada");
      load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Revocar no se deshace: pregunta ahí mismo, debajo de la fila.
  const revokeButton = (id: string | number, label: string) => confirmId !== id && (
    <button type="button" onClick={() => setConfirmId(id)}
      className="min-h-[44px] -my-1 px-1 shrink-0 text-sm font-semibold text-destructive">
      {label}
    </button>
  );
  const revokeConfirm = (id: string | number, question: string, confirmLabel: string, onConfirm: () => void) => confirmId === id && (
    <div className="mt-2 mb-1">
      <ConfirmInline question={question} confirmLabel={confirmLabel} busy={busy}
        onConfirm={onConfirm} onCancel={() => setConfirmId(null)} />
    </div>
  );

  const appsCount = connections.length === 0
    ? "Ninguna app conectada"
    : connections.length === 1 ? "1 app conectada" : `${connections.length} apps conectadas`;
  const hint = error
    ? "No se pudo cargar"
    : loaded
      ? [appsCount, tokens.length ? (tokens.length === 1 ? "1 token" : `${tokens.length} tokens`) : null].filter(Boolean).join(" · ")
      : "Preguntale por tus números, o cargá conversando";

  return (
    <>
      <SettingsRow icon={Plug} title="Conectar con una IA" hint={hint} onClick={() => setOpen(true)} />
      {open && (
        <FormSheet title="Conectar con una IA" onClose={() => { setOpen(false); setConfirmId(null); }}>
          <div className={`${FORM_SHEET_BODY} !pb-4`}>
            <p className={`${SHEET_TEXT} px-1.5`}>
              {business ? (
                <>
                  Conectá tood a un asistente de IA para consultar cómo viene tu negocio y
                  cargar movimientos conversando. Antes de guardar cualquier cambio, el asistente te
                  muestra qué va a hacer para que lo confirmes.
                </>
              ) : (
                <>
                  Conectá tood a un asistente de IA para preguntarle sobre tus gastos, tus
                  ingresos o el impacto de una compra. El asistente puede{" "}
                  <strong className="text-foreground">leer</strong> los datos de tu hogar y{" "}
                  <strong className="text-foreground">cargar o corregir gastos, ingresos, tarjetas y gastos
                  compartidos</strong> (por ejemplo «anotá 12 lucas de verdulería», un recibo de sueldo o
                  un resumen del banco),
                  siempre con una vista previa que confirmás vos.
                </>
              )}
            </p>

            <div className={SHEET_BLOCK}>
              <label htmlFor="mcp-url" className="text-xs text-[#4A4658]">Dirección del conector</label>
              <div className="mt-1 flex items-center gap-2">
                {/* An input, not a <code> block: `break-all` wrapped the URL across
                    lines and a copy from the rendered text dragged those breaks with
                    it. One line that scrolls, read-only, and copying takes the value
                    from the field rather than from the selection. */}
                <input
                  id="mcp-url"
                  readOnly
                  value={connectorUrl || "Cargando…"}
                  onFocus={e => e.currentTarget.select()}
                  aria-label="Dirección del conector"
                  className="flex-1 min-w-0 bg-transparent font-marca !text-[13px] text-foreground truncate outline-none"
                />
                {connectorUrl && <CopyButton value={connectorUrl} className="shrink-0 h-11" />}
              </div>
              <p className="mt-2 text-sm leading-snug text-[#4A4658]">
                Agregala en tu asistente como conector personalizado. Te va a pedir iniciar
                sesión para autorizarlo.{" "}
                <a href={siteHref("/conectar")} className="font-semibold text-[#3B2FB3] underline underline-offset-2">Ver el paso a paso</a>
              </p>
            </div>

            <div>
              <h4 className="px-1.5 text-[15px] font-medium text-[#4A4658]">Apps conectadas</h4>
              {connections.length === 0 ? (
                <p className={`${SHEET_TEXT} px-1.5 py-2`}>Todavía no conectaste ninguna app.</p>
              ) : (
                <MotionList className="divide-y divide-ink/[0.08]">
                  {connections.map(c => (
                    <div key={c.grant_id} className="px-1.5 py-2.5">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-semibold text-foreground truncate">{c.client_name}</p>
                          {c.connected_at && <p className="text-sm text-[#4A4658]">Conectada el {shortDate(c.connected_at)}</p>}
                          <p className="text-sm text-[#4A4658]">Último uso {relative(c.last_used_at)}</p>
                          <Chip tone="violet" className="mt-1.5">{connectorScopeLabel()}</Chip>
                        </div>
                        {revokeButton(c.grant_id, "Desconectar")}
                      </div>
                      {revokeConfirm(c.grant_id, `¿Desconectar ${c.client_name}? Deja de poder leer y cargar datos.`, "Sí, desconectar", () => disconnect(c.grant_id))}
                    </div>
                  ))}
                </MotionList>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 px-1.5">
                <h4 className="text-[15px] font-medium text-[#4A4658]">Token</h4>
                {!showForm && (
                  <Button variant="outline" className="h-10" onClick={() => setShowForm(true)}>
                    Crear token
                  </Button>
                )}
              </div>
              <p className={`${SHEET_TEXT} px-1.5 mt-1`}>
                Para los asistentes que piden una clave en vez de iniciar sesión.
              </p>

              {showForm && (
                <div className={`${SHEET_BLOCK} mt-2 space-y-2`}>
                  <input
                    className={`${FIELD} !mt-0`}
                    placeholder="Nombre (ej. asistente de la notebook)"
                    aria-label="Nombre del token"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    maxLength={100}
                  />
                  <SelectField value={expiry} onChange={setExpiry}
                    options={EXPIRY_OPTIONS.map(o => ({ value: o.value, label: o.value === "never" ? o.label : `Vence en ${o.label}` }))} />
                  <div className="flex items-center gap-2 pt-1">
                    <Button variant="ghost" className="h-11 px-3 text-foreground" onClick={() => setShowForm(false)}>
                      Cancelar
                    </Button>
                    <Button className="flex-1 h-11" onClick={createToken} disabled={busy}>
                      {busy ? "Creando…" : "Crear"}
                    </Button>
                  </div>
                </div>
              )}

              {created && (
                <div className={`${SHEET_NOTICE} mt-2`}>
                  <p className="text-[15px] font-semibold text-foreground">
                    Guardá este token ahora: no vas a poder verlo de nuevo.
                  </p>
                  <code className="block bg-white rounded-xl px-3 py-2 font-marca text-xs break-all">
                    {created.token}
                  </code>
                  <div className="flex gap-2 pt-1">
                    <CopyButton value={created.token} label="Copiar token" className="h-11" />
                    <Button variant="outline" className="h-11" onClick={() => setCreated(null)}>
                      Ya lo guardé
                    </Button>
                  </div>
                </div>
              )}

              {tokens.length === 0 ? (
                !showForm && !created && <p className={`${SHEET_TEXT} px-1.5 mt-1`}>Todavía no creaste ninguno.</p>
              ) : (
                <MotionList className="mt-1 divide-y divide-ink/[0.08]">
                  {tokens.map(t => (
                    <div key={t.id} className="px-1.5 py-2.5">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-semibold text-foreground truncate">
                            {t.name || "Sin nombre"}
                          </p>
                          <p className="font-marca text-xs text-[#4A4658]">{t.token_prefix}…</p>
                          <p className="text-sm text-[#4A4658]">
                            {t.expires_at ? `Vence el ${shortDate(t.expires_at)}` : "Sin vencimiento"} ·
                            último uso {relative(t.last_used_at)}
                          </p>
                          {t.expired && <Chip tone="rose" className="mt-1.5">Vencido</Chip>}
                        </div>
                        {revokeButton(t.id, "Revocar")}
                      </div>
                      {revokeConfirm(t.id, `¿Revocar ${t.name || "este token"}? Lo que lo use deja de andar.`, "Sí, revocar", () => revokeToken(t.id))}
                    </div>
                  ))}
                </MotionList>
              )}
            </div>

            {error && <p role="alert" className="text-sm text-rose-800 bg-rose-50 rounded-xl px-3 py-2">{error}</p>}
          </div>
        </FormSheet>
      )}
    </>
  );
}
