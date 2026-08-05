"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api";
import { formatARS, getErrorMessage } from "@/lib/utils";
import { Copy, Check, MessageCircle, CheckCircle2, Unlink, Mail, UserPlus, Trash2 } from "lucide-react";
import { COUNTRIES } from "@/lib/countries";
import WhatsAppVerifyForm from "@/components/WhatsAppVerifyForm";
import { resetAllTours } from "@/components/ProductTour";
import { Card } from "@/components/ui/card";
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
        Con qué cotización se valúa en pesos tu tenencia en dólares. Cambia solo cómo se
        muestra: no afecta ninguna operación ya registrada.
      </p>
      <div className="flex flex-wrap gap-2">
        {FX_RATE_TYPES.map(t => (
          <button key={t.value} type="button" disabled={saving || rateType === null}
            onClick={() => save(t.value)}
            className={`px-3 py-1.5 text-sm rounded-full border-2 font-medium transition-colors disabled:opacity-50 ${rateType === t.value ? "border-ink bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-accent"}`}>
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
  const [method, setMethod] = useState<"none" | "email" | "whatsapp">("none");
  const [email, setEmail] = useState("");
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

  const sendEmail = () => {
    if (!email.trim()) return;
    const subject = encodeURIComponent("Invitacion a RegistrApp");
    const body = encodeURIComponent(buildMessage());
    window.open("mailto:" + email + "?subject=" + subject + "&body=" + body, "_blank");
  };

  return (
    <Card className="p-6 space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <UserPlus className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-foreground">Invitar amigo</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Invitá a alguien a probar RegistrApp. Va a crear su propia cuenta y hogar, sin relación con el tuyo.
        </p>
      </div>
      <div className="flex gap-2">
        <button onClick={() => setMethod(method === "email" ? "none" : "email")}
          className="flex items-center gap-1.5 px-3 py-2 rounded-full text-sm border-2 border-transparent text-muted-foreground hover:bg-accent aria-pressed:bg-accent aria-pressed:border-primary aria-pressed:text-primary transition-colors"
          aria-pressed={method === "email"}
        >
          <Mail className="w-4 h-4" /> Email
        </button>
        <button onClick={() => setMethod(method === "whatsapp" ? "none" : "whatsapp")}
          className="flex items-center gap-1.5 px-3 py-2 rounded-full text-sm border-2 border-transparent text-muted-foreground hover:bg-accent aria-pressed:bg-emerald-50 aria-pressed:border-emerald-300 aria-pressed:text-emerald-700 transition-colors"
          aria-pressed={method === "whatsapp"}
        >
          <MessageCircle className="w-4 h-4" /> WhatsApp
        </button>
      </div>
      {method === "email" && (
        <div className="space-y-3">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="correo@ejemplo.com" className="w-full border rounded-lg px-3 py-2 text-sm" />
          <Button onClick={sendEmail} disabled={!email.trim()}>
            Enviar invitacion
          </Button>
          <p className="text-xs text-muted-foreground">Abre tu cliente de correo con el mensaje listo.</p>
        </div>
      )}
      {method === "whatsapp" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <select value={prefix} onChange={e => { setPrefix(e.target.value); setLocalPhone(""); }}
              className="border rounded-lg px-2 py-2 text-sm bg-card shrink-0">
              {COUNTRIES.map(c => (
                <option key={c.prefix} value={c.prefix}>{c.flag} +{c.prefix}</option>
              ))}
            </select>
            <input type="tel" value={localPhone}
              onChange={e => setLocalPhone(e.target.value.replace(/[^0-9 ]/g, ""))}
              placeholder={country.placeholder} inputMode="numeric"
              className="flex-1 border rounded-lg px-3 py-2 text-sm min-w-0" />
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
      <div className="flex items-center gap-2">
        <MessageCircle className="w-5 h-5 text-emerald-600" />
        <h3 className="font-semibold text-foreground">WhatsApp</h3>
      </div>

      {isLinked ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span className="text-sm text-foreground">Vinculado: <span className="font-medium">+{appUser.whatsapp_phone}</span></span>
          </div>
          <p className="text-xs text-muted-foreground">
            Enviá mensajes al bot con el formato <span className="font-mono bg-muted px-1 rounded">monto descripción</span> para registrar egresos. Ej: <span className="font-mono bg-muted px-1 rounded">15000 supermercado</span>
          </p>
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

      <Card className="p-6 space-y-4">
        <h3 className="font-semibold text-foreground">{"Tu hogar"}</h3>
        <p className="text-sm text-muted-foreground">
          {"Comparte este código con quien quieras que se una a tu hogar."}
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
      </Card>

      <CurrencySettingsSection />

      <InviteFriendSection />

      <Card className="p-6 space-y-4">
        <h3 className="font-semibold text-foreground">Miembros ({members.length})</h3>
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
      </Card>

      <WhatsAppSection />

      <Card className="p-6 space-y-2">
        <h3 className="font-semibold text-foreground">Guía de la app</h3>
        <p className="text-sm text-muted-foreground">Volvé a ver la guía introductoria de cada sección.</p>
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
