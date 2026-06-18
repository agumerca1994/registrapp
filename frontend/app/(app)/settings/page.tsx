"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api";
import { Copy, Check } from "lucide-react";

interface Member {
  id: number;
  display_name: string | null;
  email: string;
  role: string;
  created_at: string;
}

const ROLE_LABELS: Record<string, string> = { admin: "Admin", member: "Miembro" };

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

      <div className="bg-white rounded-xl border p-6 space-y-2">
        <h3 className="font-semibold text-gray-900">Tu cuenta</h3>
        <p className="text-sm text-gray-700">{appUser?.display_name || "—"}</p>
        <p className="text-sm text-muted-foreground">{appUser?.email}</p>
        <p className="text-xs text-muted-foreground">Rol: {ROLE_LABELS[appUser?.role ?? ""] ?? appUser?.role}</p>
      </div>
    </div>
  );
}
