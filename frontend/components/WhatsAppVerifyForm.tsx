"use client";

import { useState } from "react";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { COUNTRIES } from "@/lib/countries";
import { FIELD, SelectField } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

const SUBMIT = "w-full h-[52px] text-[15.5px]";
const LINK = "min-h-[44px] text-sm text-[#4A4658] underline-offset-2 hover:underline disabled:opacity-50";

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
    } catch (e: unknown) {
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
    } catch (e: unknown) {
      setError(getErrorMessage(e, "No se pudo mandar el código. Probá de nuevo."));
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
    } catch (e: unknown) {
      setError(getErrorMessage(e, "El código no es correcto o ya venció."));
    } finally {
      setLoading(false);
    }
  };

  const errorLine = error && <p role="alert" className="text-sm text-rose-800 bg-rose-50 rounded-xl px-3 py-2">{error}</p>;
  const skipLink = onSkip && (
    <button type="button" onClick={skipForNow} disabled={skipping} className={`block ${LINK}`}>
      {skipping ? "Un momento…" : "No recibí un código, verificar más tarde"}
    </button>
  );

  if (phase === "idle") {
    return (
      <div className="space-y-3">
        <p className={`text-sm text-[#4A4658] ${onSkip ? "" : "px-1.5"}`}>Vinculá tu número para empezar.</p>
        <div className="flex items-start gap-2">
          <SelectField
            value={prefix}
            onChange={v => { setPrefix(v); setLocalPhone(""); }}
            options={COUNTRIES.map(c => ({ value: c.prefix, label: `${c.flag} +${c.prefix}` }))}
            className="w-[7.5rem] shrink-0"
          />
          <input
            type="tel"
            value={localPhone}
            onChange={e => setLocalPhone(e.target.value.replace(/[^\d\s]/g, ""))}
            placeholder={country.placeholder}
            aria-label="Tu número de WhatsApp"
            inputMode="numeric"
            className={`${FIELD} flex-1`}
          />
        </div>
        <Button type="button" onClick={sendCode} disabled={loading || !localPhone.trim()} className={SUBMIT}>
          {loading ? "Enviando…" : "Enviar código"}
        </Button>
        {errorLine}
        {skipLink}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className={`text-sm text-[#4A4658] ${onSkip ? "" : "px-1.5"}`}>
        Te enviamos un código de 6 dígitos al <span className="font-semibold text-foreground">+{fullPhone}</span> por WhatsApp.
      </p>
      <input
        type="text"
        value={code}
        onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="123456"
        aria-label="Código de 6 dígitos"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        className={`${FIELD} text-center tracking-[0.3em] tabular-nums`}
      />
      <Button type="button" onClick={verifyCode} disabled={loading || code.length < 6} className={SUBMIT}>
        {loading ? "Verificando…" : "Verificar"}
      </Button>
      {errorLine}
      <div>
        <button type="button" onClick={() => { setPhase("idle"); setCode(""); setError(""); }} className={`block ${LINK}`}>
          Cambiar número
        </button>
        {skipLink}
      </div>
    </div>
  );
}
