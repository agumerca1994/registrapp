"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

export default function OnboardingPage() {
  const router = useRouter();
  const { refreshUser } = useAuth();
  const [mode, setMode] = useState<"create" | "join">("create");
  const [tenantName, setTenantName] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (mode === "create") {
        await api.post("/auth/register", { tenant_name: tenantName, display_name: displayName });
      } else {
        await api.post("/auth/join", { tenant_id: parseInt(tenantId), display_name: displayName });
      }
      await refreshUser();
      router.replace("/dashboard");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Ocurrió un error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-md flex flex-col gap-6">
        <h1 className="text-2xl font-bold text-gray-900">Configurar cuenta</h1>

        <div className="flex gap-2">
          <button
            onClick={() => setMode("create")}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${mode === "create" ? "bg-primary text-white" : "border text-gray-600 hover:bg-gray-50"}`}
          >
            Crear hogar nuevo
          </button>
          <button
            onClick={() => setMode("join")}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${mode === "join" ? "bg-primary text-white" : "border text-gray-600 hover:bg-gray-50"}`}
          >
            Unirme a un hogar
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-sm font-medium text-gray-700">Tu nombre</label>
            <input
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Cómo querés que te identifiquen"
              required
            />
          </div>

          {mode === "create" ? (
            <div>
              <label className="text-sm font-medium text-gray-700">Nombre del hogar</label>
              <input
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
                placeholder="Ej: Casa García"
                required
              />
            </div>
          ) : (
            <div>
              <label className="text-sm font-medium text-gray-700">ID del hogar</label>
              <input
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                placeholder="El admin del hogar te lo comparte"
                required
                type="number"
              />
            </div>
          )}

          {error && <p className="text-destructive text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="bg-primary text-white rounded-lg py-2.5 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? "Configurando..." : mode === "create" ? "Crear hogar" : "Unirme"}
          </button>
        </form>
      </div>
    </div>
  );
}
