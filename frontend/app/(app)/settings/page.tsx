"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api";
import { Copy, Check, MessageCircle, CheckCircle2, Unlink } from "lucide-react";

interface Member {
  id: number;
  display_name: string | null;
  email: string;
  role: string;
  created_at: string;
}

const ROLE_LABELS: Record<string, string> = { admin: "Admin", member: "Miembro" };

function WhatsAppSection() {
  const { appUser, refreshUser } = useAuth();
  const [phase, setPhase] = useState<"idle" | "pending">("idle");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isLinked = !!appUser?.whatsapp_phone;

  const sendCode = async () => {
    if (!phone.trim()) return;
    setLoading(true); setError("");
    try {
      await api.post("/auth/me/link-whatsapp", { phone: phone.trim() });
      setPhase("pending");
    } catch (e: any) {
      setError(e.response?.data?.detail ?? "Error al enviar el código");
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (!code.trim()) return;
    setLoading(true); setError("");
    try {
      await api.post("/auth/me/verify-whatsapp", { phone: phone.trim(), code: code.trim() });
      await refreshUser();
      setPhase("idle"); setPhone(""); setCode("");
    } catch (e: any) {
      setError(e.response?.data?.detail ?? "Código incorrecto o expirado");
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
      setError(e.response?.data?.detail ?? "Error al desvincular");
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
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="5491112345678"
              className="flex-1 border rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={sendCode}
              disabled={loading || !phone.trim()}
              className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              {loading ? "Enviando..." : "Enviar código"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Formato internacional sin +. Ej: 5491112345678</p>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Te enviamos un código de 6 dígitos al <span className="font-medium">+{phone}</span> por WhatsApp.
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
  const { appUser } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get("/auth/members").then(r => setMembers(r.data));
  }, []);

  const copyId = () => {
    navigator.clipboard.writeText(String(appUser?.tenant_id));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-2xl space-y-8">
      <h2 className="text-2xl font-bold text-gray-900">Configuración</h2>

      <div className="bg-white rounded-xl border p-6 space-y-4">
        <h3 className="font-semibold text-gray-900">Tu hogar</h3>
        <p className="text-sm text-muted-foreground">
          Compartí este ID con las personas que querés que se unan a tu hogar.
          Ellas deben iniciar sesión con Google y elegir "Unirme a un hogar" en el onboarding.
        </p>
        <div className="flex items-center gap-3">
          <div className="flex-1 bg-gray-50 border rounded-lg px-4 py-3">
            <p className="text-xs text-muted-foreground mb-1">ID del hogar</p>
            <p className="text-2xl font-bold text-primary">{appUser?.tenant_id}</p>
          </div>
          <button
            onClick={copyId}
            className="flex items-center gap-2 border px-4 py-3 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
            {copied ? "¡Copiado!" : "Copiar"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border p-6 space-y-4">
        <h3 className="font-semibold text-gray-900">Miembros ({members.length})</h3>
        <div className="divide-y">
          {members.map(m => (
            <div key={m.id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {m.display_name || m.email}
                  {m.id === appUser?.id && (
                    <span className="ml-2 text-xs text-muted-foreground">(vos)</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{m.email}</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                m.role === "admin" ? "bg-primary/10 text-primary" : "bg-gray-100 text-gray-600"
              }`}>
                {ROLE_LABELS[m.role] ?? m.role}
              </span>
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
