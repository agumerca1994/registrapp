"use client";

import { useEffect, useMemo, useState } from "react";
import { UserRound } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

interface Person { id: number; name: string; }

/**
 * Quién cargó cada cosa. Sólo dice algo si en este hogar hay más de una persona:
 * con una sola, una etiqueta "Vos" en cada fila no agrega nada.
 *
 * Los nombres salen de /auth/people y no de /auth/members porque lo que cargó
 * alguien que se fue del hogar sigue acá. Si falla, la pantalla queda como si
 * fuera un hogar de una persona: nunca frena la lista.
 */
export function useLoadedBy() {
  const { appUser } = useAuth();
  const [people, setPeople] = useState<Person[]>([]);

  useEffect(() => {
    api.get<Person[]>("/auth/people").then(({ data }) => setPeople(data)).catch(() => {});
  }, []);

  return useMemo(() => {
    const active = people.length > 1;
    const label = (p: Person) => (p.id === appUser?.id ? "Vos" : p.name);
    return {
      active,
      options: active ? people.map(p => ({ value: String(p.id), label: label(p) })) : [],
      nameOf: (id?: number | null): string | undefined => {
        if (!active || !id) return undefined;
        const person = people.find(p => p.id === id);
        return person && label(person);
      },
    };
  }, [people, appUser?.id]);
}

export function LoadedByTag({ name }: { name?: string }) {
  if (!name) return null;
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground min-w-0" title={`Lo cargó: ${name}`}>
      <UserRound className="w-3 h-3 shrink-0" aria-hidden />
      <span className="sr-only">Lo cargó: </span>
      <span className="truncate">{name}</span>
    </span>
  );
}
