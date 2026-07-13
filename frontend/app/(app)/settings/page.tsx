"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { Copy, Check, MessageCircle, CheckCircle2, Unlink, Mail, UserPlus, Trash2 } from "lucide-react";

interface Member {
  id: number;
  display_name: string | null;
  email: string;
  role: string;
  created_at: string;
}

const ROLE_LABELS: Record<string, string> = { admin: "Admin", member: "Miembro" };

const COUNTRIES = [
  { flag: "🇦🇷", prefix: "54", placeholder: "351 234 5678" },
  { flag: "🇺🇾", prefix: "598", placeholder: "9 234 5678" },
  { flag: "🇨🇱", prefix: "56", placeholder: "9 1234 5678" },
  { flag: "🇧🇷", prefix: "55", placeholder: "11 98765 4321" },
  { flag: "🇵🇾", prefix: "595", placeholder: "981 234 567" },
];

function HouseholdInviteSection() {
  const { appUser } = useAuth();
  const [method, setMethod] = useState<"none" | "email" | "whatsapp">("none");
  const [email, setEmail] = useState("");
  const [prefix, setPrefix] = useState("54");
  const [localPhone, setLocalPhone] = useState("");

  const country = COUNTRIES.find(c => c.prefix === prefix) ?? COUNTRIES[0];
  const digits = localPhone.replace(/[^0-9]/g, "");
  const fullPhone = prefix === "54" ? prefix + "9" + digits : prefix + digits;
  const code = appUser?.tenant_code ?? String(appUser?.tenant_id ?? "");
  const name = appUser?.display_name || appUser?.email || "Alguien";
  const appUrl = typeof window !== "undefined" ? window.location.origin : "";

  const buildMessage = () => [
    "Hola! " + name + " te invita a sumarte a su hogar en RegistrApp.",
    "",
    "Para unirte:",
    "1. Ingresa a " + appUrl,
    "2. Inicia sesion con Google",
    "3. Elige la opcion Unirme a un hogar",
    "4. Ingresa el codigo: " + code,
  ].join(String.fromCharCode(10));

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
    <div className="bg-white rounded-xl border p-6 space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <UserPlus className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-gray-900">Invitar al hogar</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {"Envia una invitacion para que alguien se una con el codigo "}
          <span className="font-mono font-semibold text-gray-800">{code}</span>.
        </p>
      </div>
      <div className="flex gap-2">
        <button onClick={() => setMethod(method === "email" ? "none" : "email")}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-200 text-gray-600 hover:bg-gray-50 aria-pressed:bg-violet-50 aria-pressed:border-violet-300 aria-pressed:text-violet-700 transition-colors"
          aria-pressed={method === "email"}
        >
          <Mail className="w-4 h-4" /> Email
        </button>
        <button onClick={() => setMethod(method === "whatsapp" ? "none" : "whatsapp")}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-200 text-gray-600 hover:bg-gray-50 aria-pressed:bg-green-50 aria-pressed:border-green-300 aria-pressed:text-green-700 transition-colors"
          aria-pressed={method === "whatsapp"}
        >
          <MessageCircle className="w-4 h-4" /> WhatsApp
        </button>
      </div>
      {method === "email" && (
        <div className="space-y-3">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="correo@ejemplo.com" className="w-full border rounded-lg px-3 py-2 text-sm" />
          <button onClick={sendEmail} disabled={!email.trim()}
            className="bg-violet-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 hover:bg-violet-700">
            Enviar invitacion
          </button>
          <p className="text-xs text-muted-foreground">Abre tu cliente de correo con el mensaje listo.</p>
        </div>
      )}
      {method === "whatsapp" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <select value={prefix} onChange={e => { setPrefix(e.target.value); setLocalPhone(""); }}
              className="border rounded-lg px-2 py-2 text-sm bg-white shrink-0">
              {COUNTRIES.map(c => (
                <option key={c.prefix} value={c.prefix}>{c.flag} +{c.prefix}</option>
              ))}
            </select>
            <input type="tel" value={localPhone}
              onChange={e => setLocalPhone(e.target.value.replace(/[^0-9 ]/g, ""))}
              placeholder={country.placeholder} inputMode="numeric"
              className="flex-1 border rounded-lg px-3 py-2 text-sm min-w-0" />
          </div>
          <button onClick={sendWhatsApp} disabled={!localPhone.trim()}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 hover:bg-green-700">
            Enviar invitacion
          </button>
          <p className="text-xs text-muted-foreground">Para Argentina: sin 0 inicial ni 15.</p>
        </div>
      )}
    </div>
  );
}

function WhatsAppSection() {
  const { appUser, refreshUser } = useAuth();
  const [phase, setPhase] = useState<"idle" | "pending">("idle");
  const [prefix, setPrefix] = useState("54");
  const [localPhone, setLocalPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isLinked = !!appUser?.whatsapp_phone;
  const digits = localPhone.replace(/\D/g, "");
  const fullPhone = prefix === "54" ? prefix + "9" + digits : prefix + digits;
  const country = COUNTRIES.find(c => c.prefix === prefix) ?? COUNTRIES[0];

  const sendCode = async () => {
    if (!localPhone.trim()) return;
    setLoading(true); setError("");
    try {
      await api.post("/auth/me/link-whatsapp", { phone: fullPhone });
      setPhase("pending");
    } catch (e: any) {
      setError(getErrorMessage(e, "Error al enviar el código"));
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (!code.trim()) return;
    setLoading(true); setError("");
    try {
      await api.post("/auth/me/verify-whatsapp", { phone: fullPhone, code: code.trim() });
      await refreshUser();
      setPhase("idle"); setLocalPhone(""); setCode("");
    } catch (e: any) {
      setError(getErrorMessage(e, "Código incorrecto o expirado"));
    } finally {
      setLoading(false);
    }
  };

  const unlink = async () => {
    setLoading(true); setError("");
    try {
      await api.delete("/auth/me/whatsapp");
      await refreshUser();
    } catch (e: any) {
      setError(getErrorMessage(e, "Error al desvincular"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border p-6 space-y-4">
      <div className="flex items-center gap-2">
        <MessageCircle className="w-5 h-5 text-green-600" />
        <h3 className="font-semibold text-gray-900">WhatsApp</h3>
      </div>

      {isLinked ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <span className="text-sm text-gray-700">Vinculado: <span className="font-medium">+{appUser.whatsapp_phone}</span></span>
          </div>
          <p className="text-xs text-muted-foreground">
            Enviá mensajes al bot con el formato <span className="font-mono bg-gray-100 px-1 rounded">monto descripción</span> para registrar egresos. Ej: <span className="font-mono bg-gray-100 px-1 rounded">15000 supermercado</span>
          </p>
          <button
            onClick={unlink}
            disabled={loading}
            className="flex items-center gap-1.5 text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
          >
            <Unlink className="w-3.5 h-3.5" />
            Desvincular
          </button>
        </div>
      ) : phase === "idle" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Vinculá tu número para registrar egresos enviando un mensaje de WhatsApp al bot.
          </p>
          <div className="flex gap-2">
            <select
              value={prefix}
              onChange={e => { setPrefix(e.target.value); setLocalPhone(""); }}
              className="border rounded-lg px-2 py-2 text-sm bg-white shrink-0"
            >
              {COUNTRIES.map(c => (
                <option key={c.prefix} value={c.prefix}>
                  {c.flag} +{c.prefix}
                </option>
              ))}
            </select>
            <input
              type="tel"
              value={localPhone}
              onChange={e => setLocalPhone(e.target.value.replace(/[^\d\s]/g, ""))}
              placeholder={country.placeholder}
              inputMode="numeric"
              className="flex-1 border rounded-lg px-3 py-2 text-sm min-w-0"
            />
            <button
              onClick={sendCode}
              disabled={loading || !localPhone.trim()}
              className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 shrink-0"
            >
              {loading ? "Enviando..." : "Enviar código"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Ingresá el número sin el código de país. Para Argentina sin el 0 inicial y sin el 15: <span className="font-mono">351 2345678</span>
          </p>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Te enviamos un código de 6 dígitos al <span className="font-medium">+{fullPhone}</span> por WhatsApp.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              maxLength={6}
              className="w-32 border rounded-lg px-3 py-2 text-sm text-center tracking-widest font-mono"
            />
            <button
              onClick={verifyCode}
              disabled={loading || code.length < 6}
              className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              {loading ? "Verificando..." : "Verificar"}
            </button>
          </div>
          <button onClick={() => { setPhase("idle"); setCode(""); setError(""); }} className="text-xs text-muted-foreground hover:underline">
            ← Cambiar número
          </button>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
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
    <div className="max-w-2xl space-y-8">
      <h2 className="text-2xl font-bold text-gray-900">{"Configuracion"}</h2>

      <div className="bg-white rounded-xl border p-6 space-y-4">
        <h3 className="font-semibold text-gray-900">{"Tu hogar"}</h3>
        <p className="text-sm text-muted-foreground">
          {"Comparte este codigo con quien quieras que se una a tu hogar."}
        </p>
        <div className="flex items-center gap-3">
          <div className="flex-1 bg-gray-50 border rounded-lg px-4 py-3">
            <p className="text-xs text-muted-foreground mb-1">{"Codigo del hogar"}</p>
            <p className="text-2xl font-bold text-primary tracking-widest">{appUser?.tenant_code ?? appUser?.tenant_id}</p>
          </div>
          <button onClick={copyId}
            className="flex items-center gap-2 border px-4 py-3 rounded-lg text-sm hover:bg-gray-50 transition-colors">
            {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copiado!" : "Copiar"}
          </button>
        </div>
      </div>

      <HouseholdInviteSection />

      <div className="bg-white rounded-xl border p-6 space-y-4">
        <h3 className="font-semibold text-gray-900">Miembros ({members.length})</h3>
        <div className="divide-y">
          {members.map(m => (
            <div key={m.id} className="flex items-center justify-between py-3 gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900">
                  {m.display_name || m.email}
                  {m.id === appUser?.id && <span className="ml-2 text-xs text-muted-foreground">(vos)</span>}
                </p>
                <p className="text-xs text-muted-foreground truncate">{m.email}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs px-2 py-1 rounded-full font-medium bg-gray-100 text-gray-600">
                  {ROLE_LABELS[m.role] ?? m.role}
                </span>
                {appUser?.role === "admin" && m.id !== appUser?.id && (
                  confirmKickId === m.id ? (
                    <div className="flex items-center gap-1">
                      <button onClick={() => kickMember(m.id)} disabled={actionLoading}
                        className="text-xs bg-red-600 text-white px-2 py-1 rounded disabled:opacity-50">
                        {actionLoading ? "..." : "Confirmar"}
                      </button>
                      <button onClick={() => setConfirmKickId(null)}
                        className="text-xs border px-2 py-1 rounded text-gray-600 hover:bg-gray-50">
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmKickId(m.id)}
                      className="text-red-400 hover:text-red-600 transition-colors" title="Eliminar del hogar">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )
                )}
                {m.id === appUser?.id && members.length > 1 && (
                  confirmLeave ? (
                    <div className="flex items-center gap-1">
                      <button onClick={leaveHousehold} disabled={actionLoading}
                        className="text-xs bg-red-600 text-white px-2 py-1 rounded disabled:opacity-50">
                        {actionLoading ? "..." : "Confirmar"}
                      </button>
                      <button onClick={() => setConfirmLeave(false)}
                        className="text-xs border px-2 py-1 rounded text-gray-600 hover:bg-gray-50">
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmLeave(true)}
                      className="text-xs text-red-500 hover:text-red-700 border border-red-200 px-2 py-1 rounded">
                      Salir
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <WhatsAppSection />

      <div className="bg-white rounded-xl border p-6 space-y-2">
        <h3 className="font-semibold text-gray-900">Tu cuenta</h3>
        <p className="text-sm text-gray-700">{appUser?.display_name || "—"}</p>
        <p className="text-sm text-muted-foreground">{appUser?.email}</p>
        <p className="text-xs text-muted-foreground">Rol: {ROLE_LABELS[appUser?.role ?? ""] ?? appUser?.role}</p>
      </div>
    </div>
  );
}
