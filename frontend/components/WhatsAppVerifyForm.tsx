"use client";

import { useState } from "react";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { COUNTRIES } from "@/lib/countries";

export default function WhatsAppVerifyForm({ onVerified, onSkip }: {
  onVerified: () => void | Promise<void>;
  onSkip?: () => void | Promise<void>;
}) {
  const [phase, setPhase] = useState<"idle" | "pending">("idle");
  const [prefix, setPrefix] = useState("54");
  const [localPhone, setLocalPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [skipping, setSkipping] = useState(false);

  const skipForNow = async () => {
    if (!onSkip) return;
    setSkipping(true); setError("");
    try {
      await api.post("/auth/me/skip-whatsapp-gate");
      await onSkip();
    } catch (e: any) {
      setError(getErrorMessage(e, "No se pudo continuar. Intentá de nuevo."));
    } finally {
      setSkipping(false);
    }
  };

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
      await onVerified();
      setPhase("idle"); setLocalPhone(""); setCode("");
    } catch (e: any) {
      setError(getErrorMessage(e, "Código incorrecto o expirado"));
    } finally {
      setLoading(false);
    }
  };

  if (phase === "idle") {
    return (
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
        {onSkip && (
          <button onClick={skipForNow} disabled={skipping} className="text-xs text-muted-foreground hover:underline disabled:opacity-50">
            {skipping ? "Un momento..." : "No recibí un código, verificar más tarde"}
          </button>
        )}
      </div>
    );
  }

  return (
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
      {onSkip && (
        <button onClick={skipForNow} disabled={skipping} className="block text-xs text-muted-foreground hover:underline disabled:opacity-50">
          {skipping ? "Un momento..." : "No recibí un código, verificar más tarde"}
        </button>
      )}
    </div>
  );
}
