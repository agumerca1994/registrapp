"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AtSign, Mail, Phone, Search, Smartphone, UserPlus, Users2, X } from "lucide-react";
import { Card as UiCard } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import api from "@/lib/api";
import { foldText, normalizePhoneNumber } from "@/lib/utils";

/**
 * Elegir con quién compartir un gasto.
 *
 * Reemplaza a los dos selectores que había —uno en /shared y otro en el modal
 * de tarjetas— que habían divergido. **No hay más selector "Del hogar /
 * Externo"**: ese toggle obligaba a clasificar a una persona antes de
 * nombrarla, que es justo lo que hacía incómodo compartirle a alguien que no
 * fuera del hogar.
 *
 * En su lugar hay un solo buscador. Se escribe un nombre, un alias, un mail o
 * un teléfono, y las secciones se arman solas.
 *
 * La regla que no hay que romper: **"Invitar a «texto»" está siempre**, no
 * aparece sólo cuando la búsqueda falla. Mandarle un gasto a alguien que quizá
 * no tiene la app es una opción de primera clase — es lo que trae usuarios
 * nuevos —, no el plan B de una búsqueda sin resultados.
 */

export type PickedParticipant =
  | { kind: "member"; user_id: number; member_name: string }
  | { kind: "user"; user_id: number; member_name: string; alias: string | null }
  | { kind: "invite"; member_name: string; contact: string }
  | { kind: "guest"; member_name: string };

interface Member { id: number; display_name: string | null; email: string }
interface Contact {
  id: number; display_name: string; contact_email: string | null;
  contact_phone: string | null; contact_user_id: number | null; person_key: string;
}
interface DirectoryUser {
  id: number; display_name: string | null; alias: string | null; same_household: boolean;
}

const looksLikeEmail = (s: string) => s.includes("@") && !s.trim().includes(" ");
const looksLikePhone = (s: string) => /^\+?[\d\s\-().]{7,}$/.test(s.trim());
const isContactish = (s: string) => looksLikeEmail(s) || looksLikePhone(s);

function Row({ icon, title, subtitle, badge, onClick }: {
  icon: React.ReactNode; title: string; subtitle?: string;
  badge?: React.ReactNode; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-accent transition-colors"
    >
      <span className="w-8 h-8 rounded-full bg-accent flex items-center justify-center shrink-0 text-muted-foreground">
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-foreground truncate">{title}</span>
        {subtitle && <span className="block text-xs text-muted-foreground truncate">{subtitle}</span>}
      </span>
      {badge}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60 px-3 pt-3 pb-1">
      {children}
    </p>
  );
}

export function ParticipantPicker({
  open, onClose, onPick, excludeUserIds = [], allowGuest = true,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (p: PickedParticipant) => void;
  excludeUserIds?: number[];
  allowGuest?: boolean;
}) {
  const [q, setQ] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [found, setFound] = useState<DirectoryUser[]>([]);
  const [lookup, setLookup] = useState<DirectoryUser | null>(null);
  const [searching, setSearching] = useState(false);
  const [dirDown, setDirDown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ(""); setFound([]); setLookup(null); setDirDown(false);
    Promise.allSettled([api.get("/auth/members"), api.get("/contacts")]).then(([m, c]) => {
      if (m.status === "fulfilled") setMembers(m.value.data);
      if (c.status === "fulfilled") setContacts(c.value.data);
    });
    setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  // Debounce: el directorio está limitado por uso, y una consulta por tecla se
  // come la cuota del usuario en una sola búsqueda.
  const term = q.trim();
  useEffect(() => {
    if (!open || term.length < 2) { setFound([]); setLookup(null); return; }
    let alive = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        if (isContactish(term)) {
          const res = await api.get(`/directory/lookup?q=${encodeURIComponent(term)}`);
          if (!alive) return;
          setLookup(res.data.found ? res.data.user : null);
          setFound([]);
        } else if (term.length >= 3) {
          const res = await api.get(`/directory/search?q=${encodeURIComponent(term)}`);
          if (!alive) return;
          setFound(res.data);
          setLookup(null);
        }
        if (alive) setDirDown(false);
      } catch {
        // Que el directorio falle NO puede bloquear el flujo: se siguen
        // mostrando el hogar, la agenda y la opción de invitar.
        if (alive) { setFound([]); setLookup(null); setDirDown(true); }
      } finally {
        if (alive) setSearching(false);
      }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [term, open]);

  const pick = useCallback((p: PickedParticipant) => { onPick(p); onClose(); }, [onPick, onClose]);

  const needle = foldText(term);
  const visibleMembers = useMemo(
    () => members.filter(m => !excludeUserIds.includes(m.id))
      .filter(m => !needle || foldText(m.display_name || m.email).includes(needle)),
    [members, excludeUserIds, needle]
  );
  const visibleContacts = useMemo(
    () => contacts
      .filter(c => !(c.contact_user_id && excludeUserIds.includes(c.contact_user_id)))
      .filter(c => !needle || foldText(c.display_name).includes(needle))
      .slice(0, needle ? 20 : 8),
    [contacts, excludeUserIds, needle]
  );
  const visibleFound = useMemo(
    () => found.filter(u => !excludeUserIds.includes(u.id)),
    [found, excludeUserIds]
  );

  const hasContactPicker = typeof navigator !== "undefined" && "contacts" in navigator;

  const pickFromDevice = async () => {
    try {
      const nav = navigator as unknown as {
        contacts: { select: (p: string[], o: { multiple: boolean }) => Promise<Array<{ name?: string[]; tel?: string[]; email?: string[] }>> };
      };
      const [c] = await nav.contacts.select(["name", "tel", "email"], { multiple: false });
      if (!c) return;
      const name = c.name?.[0] || "";
      const raw = c.tel?.[0] || c.email?.[0] || "";
      const contact = c.tel?.[0] ? (normalizePhoneNumber(raw).isValid ? raw : raw) : raw;
      if (!contact) { setQ(name); return; }
      pick({ kind: "invite", member_name: name || contact, contact });
    } catch {
      // El usuario canceló, o el navegador dijo que no. Ninguna de las dos es
      // un error que valga interrumpirlo.
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Elegir con quién compartir"
    >
      <UiCard
        className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-0 overflow-hidden flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 p-4 pb-3 border-b">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground/50"
            placeholder="Nombre, alias, mail o teléfono"
            value={q}
            onChange={e => setQ(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
          />
          <button onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground p-1 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-1">
          {visibleMembers.length > 0 && (
            <>
              <SectionLabel>De tu hogar</SectionLabel>
              {visibleMembers.map(m => (
                <Row
                  key={`m${m.id}`}
                  icon={<Users2 className="w-4 h-4" />}
                  title={m.display_name || m.email}
                  onClick={() => pick({ kind: "member", user_id: m.id, member_name: m.display_name || m.email })}
                />
              ))}
            </>
          )}

          {visibleContacts.length > 0 && (
            <>
              <SectionLabel>{term ? "Tus contactos" : "Frecuentes"}</SectionLabel>
              {visibleContacts.map(c => (
                <Row
                  key={`c${c.id}`}
                  icon={c.contact_email && !c.contact_phone ? <Mail className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
                  title={c.display_name}
                  subtitle={c.contact_phone || c.contact_email || undefined}
                  badge={c.contact_user_id ? <Chip tone="emerald">En la app</Chip> : undefined}
                  onClick={() => pick(
                    c.contact_user_id
                      ? { kind: "user", user_id: c.contact_user_id, member_name: c.display_name, alias: null }
                      : { kind: "invite", member_name: c.display_name, contact: c.contact_phone || c.contact_email || "" }
                  )}
                />
              ))}
            </>
          )}

          {(visibleFound.length > 0 || lookup) && (
            <>
              <SectionLabel>En RegistrApp</SectionLabel>
              {lookup && (
                <Row
                  key={`l${lookup.id}`}
                  icon={<AtSign className="w-4 h-4" />}
                  title={lookup.display_name || "Usuario de RegistrApp"}
                  subtitle={lookup.alias ? `@${lookup.alias}` : undefined}
                  badge={<Chip tone="emerald">Ya usa RegistrApp</Chip>}
                  onClick={() => pick({ kind: "user", user_id: lookup.id, member_name: lookup.display_name || "Usuario", alias: lookup.alias })}
                />
              )}
              {visibleFound.map(u => (
                <Row
                  key={`f${u.id}`}
                  icon={<AtSign className="w-4 h-4" />}
                  title={u.display_name || "Usuario de RegistrApp"}
                  subtitle={u.alias ? `@${u.alias}` : undefined}
                  badge={u.same_household ? <Chip tone="violet">Tu hogar</Chip> : undefined}
                  onClick={() => pick({ kind: "user", user_id: u.id, member_name: u.display_name || "Usuario", alias: u.alias })}
                />
              ))}
            </>
          )}

          {searching && <p className="text-xs text-muted-foreground px-3 py-2">Buscando…</p>}
          {dirDown && (
            <p className="text-xs text-muted-foreground px-3 py-2">
              No se pudo buscar en RegistrApp ahora. Podés invitarlo igual.
            </p>
          )}

          {/* Siempre presente, siempre última: invitar no es el plan B de una
              búsqueda fallida, es una opción de primera clase. */}
          {term && !lookup && (
            <>
              <SectionLabel>Otras opciones</SectionLabel>
              <Row
                icon={<UserPlus className="w-4 h-4" />}
                title={`Invitar a "${term}"`}
                subtitle={isContactish(term)
                  ? "Le llega una invitación para sumarse"
                  : "Escribí su mail o teléfono para invitarlo"}
                onClick={() => {
                  if (isContactish(term)) pick({ kind: "invite", member_name: term, contact: term });
                  else inputRef.current?.focus();
                }}
              />
              {allowGuest && (
                <Row
                  icon={<UserPlus className="w-4 h-4" />}
                  title={`Agregar "${term}" sin cuenta`}
                  subtitle="Sólo para anotar tu parte, no se le avisa"
                  onClick={() => pick({ kind: "guest", member_name: term })}
                />
              )}
            </>
          )}

          {!term && (
            <>
              <SectionLabel>Otras opciones</SectionLabel>
              {/* Escondido si el navegador no lo soporta, en vez de un botón que
                  al tocarlo dice que no se puede — que es lo que hacía antes. */}
              {hasContactPicker && (
                <Row
                  icon={<Smartphone className="w-4 h-4" />}
                  title="Elegir de mis contactos del teléfono"
                  onClick={pickFromDevice}
                />
              )}
              <Row
                icon={<UserPlus className="w-4 h-4" />}
                title="Escribí un nombre, mail o teléfono"
                subtitle="Para invitar a alguien que todavía no tiene la app"
                onClick={() => inputRef.current?.focus()}
              />
            </>
          )}
        </div>
      </UiCard>
    </div>
  );
}
