"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AtSign, Mail, Phone, Search, Smartphone, UserPlus, Users2 } from "lucide-react";
import { FORM_SHEET_BODY, FormSheet } from "@/components/movimientos/FormSheet";
import { Chip } from "@/components/ui/chip";
import { FIELD } from "@/components/ui/form";
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
      className="w-full min-h-[56px] flex items-center gap-3 px-2 py-2 rounded-2xl text-left md:hover:bg-white/70 active:scale-[0.98] transition-[transform,background-color] duration-100"
    >
      <span className="w-10 h-10 rounded-full bg-accent flex items-center justify-center shrink-0 text-[#3B2FB3]">
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15.5px] font-semibold text-foreground truncate">{title}</span>
        {subtitle && <span className="block text-sm text-muted-foreground truncate">{subtitle}</span>}
      </span>
      {badge}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-muted-foreground px-2 pt-2.5 pb-0.5">
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
  // Sub-formulario de invitación. Antes "Invitar a «X»" sólo hacía focus() en
  // el buscador: al tocarlo no pasaba nada visible, que es exactamente lo que
  // un botón nunca puede hacer.
  const [inviting, setInviting] = useState<{ name: string; contact: string } | null>(null);
  const [inviteError, setInviteError] = useState("");
  const contactRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [dirDown, setDirDown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ(""); setFound([]); setLookup(null); setDirDown(false);
    setInviting(null); setInviteError("");
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

  /** Abre el sub-formulario con el término ya puesto en el campo que
   *  corresponda: si escribiste un mail va a contacto, si escribiste un nombre
   *  va a nombre. Así el paso siguiente es siempre el campo que falta. */
  const startInvite = useCallback((raw: string) => {
    const t = raw.trim();
    const asContact = isContactish(t);
    setInviting({ name: asContact ? "" : t, contact: asContact ? t : "" });
    setInviteError("");
    // Sin término no falta "el otro campo": se arranca por el nombre.
    setTimeout(() => (asContact || !t ? nameRef : contactRef).current?.focus(), 60);
  }, []);

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

  function confirmInvite() {
    if (!inviting) return;
    const name = inviting.name.trim();
    const contact = inviting.contact.trim();
    if (!name && !contact) { setInviteError("Poné al menos un nombre."); return; }
    if (contact && !isContactish(contact)) {
      setInviteError("Eso no parece un mail ni un teléfono.");
      return;
    }
    // Sin contacto no hay a quién invitar: es un externo sin cuenta, que es una
    // cosa distinta y el backend la crea ya aceptada.
    if (!contact) { pick({ kind: "guest", member_name: name }); return; }
    pick({ kind: "invite", member_name: name || contact, contact });
  }

  if (!open) return null;

  // `stacked`: se abre arriba del formulario que lo pidió. Quien lo usa lo pone como
  // hermano de su hoja, nunca adentro (ver FormSheet).
  return (
    <FormSheet stacked title="Elegir con quién compartir" onClose={onClose}>
      {inviting !== null ? (
        <div className={`${FORM_SHEET_BODY} pb-3.5`}>
          <p className="px-1.5 text-sm text-[#4A4658]">
            Si ya tiene cuenta con ese mail o teléfono, el gasto le aparece
            directo en su app.
          </p>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Nombre</label>
            <input
              ref={nameRef}
              aria-label="Nombre"
              className={FIELD}
              placeholder="Cómo lo querés ver en el gasto"
              value={inviting.name}
              onChange={e => { setInviteError(""); setInviting(v => v && { ...v, name: e.target.value }); }}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Mail o teléfono</label>
            <input
              ref={contactRef}
              aria-label="Mail o teléfono"
              className={FIELD}
              placeholder="ana@mail.com o +54 9 11 1234 5678"
              value={inviting.contact}
              onChange={e => { setInviteError(""); setInviting(v => v && { ...v, contact: e.target.value }); }}
              autoCapitalize="none"
              autoCorrect="off"
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); confirmInvite(); } }}
            />
          </div>
          {/* La app no manda mails. Decirlo acá y no después: si el que
              comparte cree que salió un correo, no le pasa el link y la otra
              persona no se entera nunca. */}
          {inviting.contact.includes("@") && (
            <p className="text-sm text-foreground bg-accent border border-[#CFC9E4] rounded-2xl px-3.5 py-2.5">
              Por mail no se envía nada automáticamente. Después de crear el
              gasto vas a poder copiar el link de invitación y pasárselo vos.
            </p>
          )}
          {!inviting.contact.includes("@") && isContactish(inviting.contact) && (
            <p className="text-sm text-foreground bg-accent border border-[#CFC9E4] rounded-2xl px-3.5 py-2.5">
              Si no tiene cuenta, le llega una invitación por WhatsApp.
            </p>
          )}

          {inviteError && (
            <p role="alert" className="text-sm text-destructive bg-destructive/10 rounded-2xl px-3.5 py-2.5">
              {inviteError}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setInviting(null)}
              className="h-[52px] px-4 rounded-full font-semibold text-[15px] text-foreground active:scale-[0.98] transition-transform duration-100">
              Volver
            </button>
            <button type="button" onClick={confirmInvite}
              className="flex-1 h-[52px] rounded-full bg-ink text-background font-semibold text-[15.5px] active:scale-[0.98] transition-transform duration-100">
              Agregar
            </button>
          </div>
          {/* Salida para el caso "no tiene ni va a tener la app": se anota
              igual, sólo que sin avisarle a nadie. */}
          {allowGuest && inviting.name.trim() && (
            <button
              type="button"
              onClick={() => pick({ kind: "guest", member_name: inviting.name.trim() })}
              className="w-full min-h-[44px] text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Agregar sin cuenta, sólo para anotar tu parte
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="shrink-0 px-3.5 pb-2">
            <div className="flex items-center gap-2 rounded-full bg-white/70 border border-white/80 px-3.5 min-h-[46px] focus-within:border-primary/50 transition-colors">
              <Search className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground"
                placeholder="Nombre, alias, mail o teléfono"
                aria-label="Nombre, alias, mail o teléfono"
                value={q}
                onChange={e => setQ(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-3">
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
                  badge={c.contact_user_id ? <Chip tone="violet">En la app</Chip> : undefined}
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
              <SectionLabel>En tood</SectionLabel>
              {lookup && (
                <Row
                  key={`l${lookup.id}`}
                  icon={<AtSign className="w-4 h-4" />}
                  title={lookup.display_name || "Usuario de tood"}
                  subtitle={lookup.alias ? `@${lookup.alias}` : undefined}
                  badge={<Chip tone="violet">Ya usa tood</Chip>}
                  onClick={() => pick({ kind: "user", user_id: lookup.id, member_name: lookup.display_name || "Usuario", alias: lookup.alias })}
                />
              )}
              {visibleFound.map(u => (
                <Row
                  key={`f${u.id}`}
                  icon={<AtSign className="w-4 h-4" />}
                  title={u.display_name || "Usuario de tood"}
                  subtitle={u.alias ? `@${u.alias}` : undefined}
                  badge={u.same_household ? <Chip tone="violet">Tu hogar</Chip> : undefined}
                  onClick={() => pick({ kind: "user", user_id: u.id, member_name: u.display_name || "Usuario", alias: u.alias })}
                />
              ))}
            </>
          )}

          {searching && <p className="text-sm text-muted-foreground px-2 py-2">Buscando…</p>}
          {dirDown && (
            <p className="text-sm text-muted-foreground px-2 py-2">
              No se pudo buscar en tood ahora. Podés invitarlo igual.
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
                  ? (term.includes("@") ? "Después le pasás vos el link de invitación" : "Le llega una invitación por WhatsApp")
                  : "Pedile el mail o el teléfono en el paso siguiente"}
                onClick={() => startInvite(term)}
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
                title="Invitar a alguien que no tiene la app"
                subtitle="Con su mail o teléfono"
                onClick={() => startInvite("")}
              />
            </>
          )}
          </div>
        </>
      )}
    </FormSheet>
  );
}
