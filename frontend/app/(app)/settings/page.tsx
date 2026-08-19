"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api";
import { PushNotificationsSection } from "@/components/PushNotificationsSection";
import { ProfileSection } from "@/components/ProfileSection";
import { formatARS, getErrorMessage, formatPhone } from "@/lib/utils";
import { Copy, Check, MessageCircle, CheckCircle2, Unlink, UserPlus, Trash2 } from "lucide-react";
import { COUNTRIES } from "@/lib/countries";
import WhatsAppVerifyForm from "@/components/WhatsAppVerifyForm";
import McpConnectorSection from "@/components/McpConnectorSection";
import { resetAllTours } from "@/components/ProductTour";
import { Card } from "@/components/ui/card";
import { FIELD, SelectField } from "@/components/ui/form";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";

interface Member {
  id: number;
  display_name: string | null;
  email: string;
  role: string;
  created_at: string;
}

const ROLE_LABELS: Record<string, string> = { admin: "Admin", member: "Miembro" };
const APP_TOUR_IDS = ["dashboard-intro", "income-intro", "expenses-intro"];

function buildHouseholdInviteMessage(name: string, code: string, appUrl: string): string {
  return [
    "Hola! " + name + " te invita a sumarte a su hogar en RegistrApp.",
    "",
    "Para unirte:",
    "1. Ingresa a " + appUrl,
    "2. Inicia sesión con Google",
    "3. Elige la opción Unirme a un hogar",
    "4. Ingresa el código: " + code,
  ].join(String.fromCharCode(10));
}

function buildFriendInviteMessage(name: string, appUrl: string): string {
  return [
    "Hola! " + name + " te invita a probar RegistrApp, una app para llevar tus ingresos, gastos y gastos compartidos.",
    "",
    "Entra a " + appUrl + " e inicia sesión con Google para crear tu cuenta.",
  ].join(String.fromCharCode(10));
}

// Which USD quote values the household's foreign-currency holding. Kept on the
// /currency router rather than on UserOut, whose tenant relationship is lazy.
const FX_RATE_TYPES = [
  { value: "blue", label: "Blue" },
  { value: "oficial", label: "Oficial" },
  { value: "mayorista", label: "Mayorista" },
  { value: "mep", label: "MEP" },
  { value: "ccl", label: "CCL" },
];

function CurrencySettingsSection() {
  const [rateType, setRateType] = useState<string | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ fx_rate_type: string; rate: string | null }>("/currency/settings")
      .then(res => {
        setRateType(res.data.fx_rate_type);
        setRate(res.data.rate !== null ? Number(res.data.rate) : null);
      })
      .catch(() => setRateType("blue"));
  }, []);

  const save = async (value: string) => {
    const previous = rateType;
    setRateType(value);
    setSaving(true);
    try {
      const res = await api.patch<{ fx_rate_type: string; rate: string | null }>(
        "/currency/settings", { fx_rate_type: value }
      );
      setRate(res.data.rate !== null ? Number(res.data.rate) : null);
      setError(null);
    } catch (e) {
      setRateType(previous);
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6 space-y-4">
      <h3 className="font-semibold text-foreground">Cotización del dólar</h3>
      <p className="text-sm text-muted-foreground">
        Con cuál se valúa tu tenencia en dólares.
      </p>
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
        {FX_RATE_TYPES.map(t => (
          <button key={t.value} type="button" disabled={saving || rateType === null}
            onClick={() => save(t.value)}
            className={`shrink-0 px-3 py-1.5 text-sm rounded-full border-2 font-medium transition-colors disabled:opacity-50 ${rateType === t.value ? "border-ink bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-accent"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {rate !== null && (
        <p className="text-sm text-muted-foreground">
          Última cotización: <strong className="text-foreground">{formatARS(rate)}</strong>
        </p>
      )}
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </Card>
  );
}

function InviteFriendSection() {
  const { appUser } = useAuth();
  // Sin mail: la app no manda correos, así que ofrecer "Email" acá era la
  // única puerta que quedaba a un canal que no existe en ningún otro lado.
  const [method, setMethod] = useState<"none" | "whatsapp">("none");
  const [prefix, setPrefix] = useState("54");
  const [localPhone, setLocalPhone] = useState("");

  const country = COUNTRIES.find(c => c.prefix === prefix) ?? COUNTRIES[0];
  const digits = localPhone.replace(/[^0-9]/g, "");
  const fullPhone = prefix === "54" ? prefix + "9" + digits : prefix + digits;
  const name = appUser?.display_name || appUser?.email || "Alguien";
  const appUrl = typeof window !== "undefined" ? window.location.origin : "";

  const buildMessage = () => buildFriendInviteMessage(name, appUrl);

  const sendWhatsApp = () => {
    if (!localPhone.trim()) return;
    window.open("https://wa.me/" + fullPhone + "?text=" + encodeURIComponent(buildMessage()), "_blank");
  };

  return (
    <Card className="p-6 space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <UserPlus className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-foreground">Invitar amigo</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Invitá a un amigo a sumarse a RegistrApp.
        </p>
      </div>
      <div className="flex gap-2">
        <button onClick={() => setMethod(method === "whatsapp" ? "none" : "whatsapp")}
          className="flex items-center gap-1.5 px-3 py-2 rounded-full text-sm border-2 border-transparent text-muted-foreground hover:bg-accent aria-pressed:bg-emerald-50 aria-pressed:border-emerald-300 aria-pressed:text-emerald-700 transition-colors"
          aria-pressed={method === "whatsapp"}
        >
          <MessageCircle className="w-4 h-4" /> WhatsApp
        </button>
      </div>
      {method === "whatsapp" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <SelectField className="w-32 shrink-0" value={prefix}
              onChange={v => { setPrefix(v); setLocalPhone(""); }}
              options={COUNTRIES.map(c => ({ value: c.prefix, label: `${c.flag} +${c.prefix}` }))} />
            <input type="tel" value={localPhone}
              onChange={e => setLocalPhone(e.target.value.replace(/[^0-9 ]/g, ""))}
              placeholder={country.placeholder} inputMode="numeric"
              className={`${FIELD} flex-1 mt-0`} />
          </div>
          <Button onClick={sendWhatsApp} disabled={!localPhone.trim()}>
            Enviar invitacion
          </Button>
          <p className="text-xs text-muted-foreground">Para Argentina: sin 0 inicial ni 15.</p>
        </div>
      )}
    </Card>
  );
}

function WhatsAppSection() {
  const { appUser, refreshUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savingPref, setSavingPref] = useState(false);

  // El aviso del sistema (push) es la base y no se apaga desde acá: no depende
  // de tener un número vinculado ni de un servicio externo. Esto gobierna sólo
  // el canal secundario.
  const toggleWaNotifs = async () => {
    setSavingPref(true);
    try {
      await api.patch("/auth/me", { whatsapp_notifications: !appUser?.whatsapp_notifications });
      await refreshUser();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "No se pudo guardar"));
    } finally {
      setSavingPref(false);
    }
  };

  const isLinked = !!appUser?.whatsapp_phone;

  const unlink = async () => {
    setLoading(true); setError("");
    try {
      await api.delete("/auth/me/whatsapp");
      await refreshUser();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Error al desvincular"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6 space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <MessageCircle className="w-5 h-5 text-emerald-600" />
          <h3 className="font-semibold text-foreground">WhatsApp</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Enviale mensajes al bot para registrar tus movimientos, ej:{" "}
          <span className="font-mono bg-muted px-1 rounded">15000 supermercado</span>
        </p>
      </div>

      {isLinked ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span className="text-sm text-foreground">Vinculado: <span className="font-medium">{formatPhone(appUser.whatsapp_phone ?? "")}</span></span>
          </div>
          <label className="flex items-start gap-3 p-3 rounded-xl border-2 border-ink bg-accent/30 cursor-pointer">
            <input
              type="checkbox"
              checked={!!appUser?.whatsapp_notifications}
              onChange={toggleWaNotifs}
              disabled={savingPref}
              className="mt-0.5 w-4 h-4 accent-primary shrink-0"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">
                Usar WhatsApp para los avisos
              </span>
              <span className="block text-xs text-muted-foreground">
                Para avisarle por WhatsApp a quien le compartís un gasto, y para
                que te avisen a vos. El aviso dentro de la app va igual: esto es
                un canal extra.
              </span>
              {/* La consecuencia que no se ve: a quien no tiene la app,
                  WhatsApp es su único canal. Decirlo acá y no cuando ya pasó. */}
              <span className="block text-xs text-amber-700 mt-1">
                Si lo apagás, a quien invites y no tenga la app no le va a llegar
                nada.
              </span>
            </span>
          </label>

          <button
            onClick={unlink}
            disabled={loading}
            className="flex items-center gap-1.5 text-sm text-destructive hover:opacity-80 disabled:opacity-50"
          >
            <Unlink className="w-3.5 h-3.5" />
            Desvincular
          </button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      ) : (
        <WhatsAppVerifyForm onVerified={refreshUser} />
      )}
    </Card>
  );
}

export default function SettingsPage() {
  const { appUser, clearUser } = useAuth();
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [copied, setCopied] = useState(false);
  const [confirmKickId, setConfirmKickId] = useState<number | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const loadMembers = () => { api.get("/auth/members").then(r => setMembers(r.data)); };
  useEffect(loadMembers, []);

  const copyId = () => {
    navigator.clipboard.writeText(appUser?.tenant_code ?? String(appUser?.tenant_id));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareHouseholdCodeByWhatsApp = () => {
    const code = appUser?.tenant_code ?? String(appUser?.tenant_id ?? "");
    const name = appUser?.display_name || appUser?.email || "Alguien";
    const appUrl = typeof window !== "undefined" ? window.location.origin : "";
    const message = buildHouseholdInviteMessage(name, code, appUrl);
    window.open("https://wa.me/?text=" + encodeURIComponent(message), "_blank");
  };

  const kickMember = async (memberId: number) => {
    setActionLoading(true);
    try {
      await api.delete("/auth/members/" + memberId);
      setConfirmKickId(null);
      loadMembers();
    } finally {
      setActionLoading(false);
    }
  };

  const leaveHousehold = async () => {
    setActionLoading(true);
    try {
      await api.post("/auth/me/leave-household");
      clearUser();
      router.replace("/onboarding");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-8">
      <h2 className="text-2xl font-display font-bold text-foreground">{"Configuración"}</h2>

      <ProfileSection />

      <InviteFriendSection />

      <Card className="p-6 space-y-4">
        <h3 className="font-semibold text-foreground">{"Tu hogar"}</h3>
        <p className="text-sm text-muted-foreground">
          {"Sumá miembros a tu hogar compartiendo este código."}
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[140px] bg-muted border rounded-lg px-4 py-3">
            <p className="text-xs text-muted-foreground mb-1">{"Código del hogar"}</p>
            <p className="text-2xl font-bold text-primary tracking-widest">{appUser?.tenant_code ?? appUser?.tenant_id}</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" onClick={copyId}>
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              {copied ? "Copiado!" : "Copiar"}
            </Button>
            <Button variant="outline" onClick={shareHouseholdCodeByWhatsApp} className="text-emerald-700">
              <MessageCircle className="w-4 h-4" />
              WhatsApp
            </Button>
          </div>
        </div>
        <div className="pt-2 border-t">
          <h4 className="text-sm font-semibold text-foreground mb-1">Miembros</h4>
        <div className="divide-y">
          {members.map(m => (
            <div key={m.id} className="flex items-center justify-between py-3 gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {m.display_name || m.email}
                  {m.id === appUser?.id && <span className="ml-2 text-xs text-muted-foreground">(vos)</span>}
                </p>
                <p className="text-xs text-muted-foreground truncate">{m.email}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Chip tone="neutral">
                  {ROLE_LABELS[m.role] ?? m.role}
                </Chip>
                {appUser?.role === "admin" && m.id !== appUser?.id && (
                  confirmKickId === m.id ? (
                    <div className="flex items-center gap-1">
                      <button onClick={() => kickMember(m.id)} disabled={actionLoading}
                        className="text-xs bg-destructive text-destructive-foreground px-2 py-1 rounded disabled:opacity-50">
                        {actionLoading ? "..." : "Confirmar"}
                      </button>
                      <button onClick={() => setConfirmKickId(null)}
                        className="text-xs border px-2 py-1 rounded text-muted-foreground hover:bg-accent">
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmKickId(m.id)}
                      className="text-destructive/60 hover:text-destructive transition-colors" title="Eliminar del hogar">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )
                )}
                {m.id === appUser?.id && members.length > 1 && (
                  confirmLeave ? (
                    <div className="flex items-center gap-1">
                      <button onClick={leaveHousehold} disabled={actionLoading}
                        className="text-xs bg-destructive text-destructive-foreground px-2 py-1 rounded disabled:opacity-50">
                        {actionLoading ? "..." : "Confirmar"}
                      </button>
                      <button onClick={() => setConfirmLeave(false)}
                        className="text-xs border px-2 py-1 rounded text-muted-foreground hover:bg-accent">
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmLeave(true)}
                      className="text-xs text-destructive hover:opacity-80 border border-destructive/30 px-2 py-1 rounded">
                      Salir
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
        </div>
      </Card>

      <PushNotificationsSection />

      <WhatsAppSection />

      <McpConnectorSection />

      <CurrencySettingsSection />

      <Card className="p-6 space-y-2">
        <h3 className="font-semibold text-foreground">Guía de la app</h3>
        <p className="text-sm text-muted-foreground">¿Necesitás ayuda? Reiniciá la guía de funcionalidades.</p>
        <Button
          variant="outline"
          onClick={() => { resetAllTours(APP_TOUR_IDS); window.location.href = "/dashboard"; }}
        >
          Reiniciar guía
        </Button>
      </Card>

      <Card className="p-6 space-y-2">
        <h3 className="font-semibold text-foreground">Tu cuenta</h3>
        <p className="text-sm text-foreground">{appUser?.display_name || "—"}</p>
        <p className="text-sm text-muted-foreground">{appUser?.email}</p>
        <p className="text-xs text-muted-foreground">Rol: {ROLE_LABELS[appUser?.role ?? ""] ?? appUser?.role}</p>
      </Card>
    </div>
  );
}
