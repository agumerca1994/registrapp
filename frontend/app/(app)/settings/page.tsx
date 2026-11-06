"use client";

import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { CHANGELOG } from "@/lib/changelog";
import { APP_VERSION, BUILD_DATE, IS_BETA } from "@/lib/version";
import { SheetSwitch } from "@/components/movimientos/FormSheet";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import api from "@/lib/api";
import { PushNotificationsSection } from "@/components/PushNotificationsSection";
import { ProfileSection } from "@/components/ProfileSection";
import { AccountClosureSection } from "@/components/account/AccountClosureSection";
import { formatARS, getErrorMessage, formatPhone } from "@/lib/utils";
import { BookOpen, Info, Check, CheckCircle2, Copy, DollarSign, Home, MessageCircle, Store, UserPlus } from "lucide-react";
import { COUNTRIES } from "@/lib/countries";
import WhatsAppVerifyForm from "@/components/WhatsAppVerifyForm";
import McpConnectorSection from "@/components/McpConnectorSection";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { MotionList } from "@/components/ui/motion-list";
import { IosShortcutSection } from "@/components/IosShortcutSection";
import { features } from "@/lib/features";
import { resetAllTours } from "@/components/ProductTour";
import { BUSINESS_TOUR_IDS } from "@/components/business/tours";
import { isBusiness, isEmployee, roleLabel, terms } from "@/lib/account";
import { WHATS_NEW_KEY } from "@/components/WhatsNewCarousel";
import { ChoiceChips } from "@/components/ui/choice-chips";
import { FIELD, SelectField } from "@/components/ui/form";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { FORM_SHEET_BODY, FORM_SHEET_FORM, FormSheet, FormSheetActions } from "@/components/movimientos/FormSheet";
import {
  ConfirmInline, SessionRow, SettingsGroup, SettingsRow, SHEET_BLOCK, SHEET_TEXT,
} from "@/components/settings/SettingsParts";

interface Member {
  id: number;
  display_name: string | null;
  email: string;
  role: string;
  created_at: string;
}


const APP_TOUR_IDS = ["dashboard-intro", "income-intro", "expenses-intro", "shared-intro", "creditos-intro", "ahorro-intro", "inversiones-intro", ...BUSINESS_TOUR_IDS];

function buildHouseholdInviteMessage(name: string, code: string, appUrl: string, business = false): string {
  // El paso 3 nombra el botón tal como se ve en /onboarding, que cambia con
  // el alta de negocios abierta.
  const joinLabel = features.businessSignup ? "Unirme con un código" : "Unirme a un hogar";
  return [
    "¡Hola! " + name + " te invita a sumarte a su " + (business ? "negocio" : "hogar") + " en tood.",
    "",
    "Para unirte:",
    "1. Entrá a " + appUrl,
    "2. Iniciá sesión con Google",
    "3. Elegí la opción " + joinLabel,
    "4. Escribí el código: " + code,
  ].join(String.fromCharCode(10));
}

function buildFriendInviteMessage(name: string, appUrl: string): string {
  return [
    "¡Hola! " + name + " te invita a probar tood, una app para llevar tus ingresos, gastos y gastos compartidos.",
    "",
    "Entrá a " + appUrl + " e iniciá sesión con Google para crear tu cuenta.",
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
  const reaccionar = useReaccion();
  useAmountsHidden();  // la última cotización pasa por formatARS
  const [open, setOpen] = useState(false);
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
    if (saving || value === rateType) return;
    const previous = rateType;
    setRateType(value);
    setSaving(true);
    try {
      const res = await api.patch<{ fx_rate_type: string; rate: string | null }>(
        "/currency/settings", { fx_rate_type: value }
      );
      setRate(res.data.rate !== null ? Number(res.data.rate) : null);
      setError(null);
      reaccionar("guardado", "Cotización guardada");
    } catch (e) {
      setRateType(previous);
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const label = FX_RATE_TYPES.find(t => t.value === rateType)?.label;

  return (
    <>
      <SettingsRow icon={DollarSign} title="Cotización del dólar" hint={label ? `Tus dólares se valúan al ${label}` : "Con cuál se valúan tus dólares"}
        onClick={() => setOpen(true)} />
      {open && (
        <FormSheet title="Cotización del dólar" onClose={() => setOpen(false)}>
          <div className={`${FORM_SHEET_BODY} !pb-4`}>
            <p className={`${SHEET_TEXT} px-1.5`}>Con cuál se valúa tu tenencia en dólares.</p>
            {rateType === null
              ? <p className={`${SHEET_TEXT} px-1.5`}>Cargando…</p>
              : <ChoiceChips wrap ariaLabel="Cotización del dólar" value={rateType} onChange={save} options={FX_RATE_TYPES} />}
            {rate !== null && (
              <p className={`${SHEET_TEXT} px-1.5`}>
                Última cotización: <strong className="text-foreground tabular-nums">{formatARS(rate)}</strong>
              </p>
            )}
            {error && <p role="alert" className="text-sm text-rose-800 bg-rose-50 rounded-xl px-3 py-2">{error}</p>}
          </div>
        </FormSheet>
      )}
    </>
  );
}

// No confundir con el código de "Tu hogar": esto invita a alguien a crear su
// propia cuenta, el código lo suma a la tuya.
function InviteFriendSection() {
  const { appUser } = useAuth();
  const [open, setOpen] = useState(false);
  // Sin mail: la app no manda correos, así que ofrecer "Email" acá era la
  // única puerta que quedaba a un canal que no existe en ningún otro lado.
  const [prefix, setPrefix] = useState("54");
  const [localPhone, setLocalPhone] = useState("");

  const country = COUNTRIES.find(c => c.prefix === prefix) ?? COUNTRIES[0];
  const digits = localPhone.replace(/[^0-9]/g, "");
  const fullPhone = prefix === "54" ? prefix + "9" + digits : prefix + digits;
  const name = appUser?.display_name || appUser?.email || "Alguien";
  const appUrl = typeof window !== "undefined" ? window.location.origin : "";

  const buildMessage = () => buildFriendInviteMessage(name, appUrl);

  const sendWhatsApp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!localPhone.trim()) return;
    window.open("https://wa.me/" + fullPhone + "?text=" + encodeURIComponent(buildMessage()), "_blank");
  };

  return (
    <>
      <SettingsRow icon={UserPlus} title="Invitar amigo" hint="Que se haga su propia cuenta en tood" onClick={() => setOpen(true)} />
      {open && (
        <FormSheet title="Invitar amigo" onClose={() => setOpen(false)}>
          <form onSubmit={sendWhatsApp} className={FORM_SHEET_FORM}>
            <div className={FORM_SHEET_BODY}>
              <p className={`${SHEET_TEXT} px-1.5`}>
                Invitá a un amigo a sumarse a tood. Se abre WhatsApp con el mensaje listo, y arma su propia cuenta:
                no ve tus datos.
              </p>
              <div>
                <div className="flex items-start gap-2">
                  <SelectField className="w-[7.5rem] shrink-0" value={prefix}
                    onChange={v => { setPrefix(v); setLocalPhone(""); }}
                    options={COUNTRIES.map(c => ({ value: c.prefix, label: `${c.flag} +${c.prefix}` }))} />
                  <input type="tel" value={localPhone} aria-label="Número de tu amigo"
                    onChange={e => setLocalPhone(e.target.value.replace(/[^0-9 ]/g, ""))}
                    placeholder={country.placeholder} inputMode="numeric"
                    className={`${FIELD} flex-1`} />
                </div>
                <p className="mt-1.5 px-1.5 text-xs text-[#4A4658]">Para Argentina: sin 0 inicial ni 15.</p>
              </div>
            </div>
            <FormSheetActions onCancel={() => setOpen(false)} saving={false} disabled={!localPhone.trim()} label="Mandar invitación" />
          </form>
        </FormSheet>
      )}
    </>
  );
}

function WhatsAppSection() {
  const reaccionar = useReaccion();
  const { appUser, refreshUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savingPref, setSavingPref] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  // El aviso del sistema (push) es la base y no se apaga desde acá: no depende
  // de tener un número vinculado ni de un servicio externo. Esto gobierna sólo
  // el canal secundario.
  const toggleWaNotifs = async () => {
    setSavingPref(true);
    try {
      await api.patch("/auth/me", { whatsapp_notifications: !appUser?.whatsapp_notifications });
      await refreshUser();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "No se pudo guardar la preferencia"));
    } finally {
      setSavingPref(false);
    }
  };

  const isLinked = !!appUser?.whatsapp_phone;

  // `/settings#whatsapp` (el "Vincular WhatsApp" de las novedades) tiene que
  // aterrizar acá, con la hoja abierta: es lo que se venía a hacer.
  useEffect(() => {
    if (window.location.hash === "#whatsapp") setOpen(true);
  }, []);

  const unlink = async () => {
    setLoading(true); setError("");
    try {
      await api.delete("/auth/me/whatsapp");
      setConfirmUnlink(false);
      await refreshUser();
      reaccionar("borrado", "WhatsApp desvinculado");
    } catch (e: unknown) {
      setError(getErrorMessage(e, "No se pudo desvincular el número"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SettingsRow id="whatsapp" icon={MessageCircle} title="WhatsApp"
        hint={isLinked ? `Vinculado: ${formatPhone(appUser.whatsapp_phone ?? "")}` : "Sin vincular"}
        onClick={() => setOpen(true)} />
      {open && (
        <FormSheet title="WhatsApp" onClose={() => setOpen(false)}>
          <div className={`${FORM_SHEET_BODY} !pb-4`}>
            <p className={`${SHEET_TEXT} px-1.5`}>
              {isEmployee(appUser) ? "Mandale un mensaje al bot para cargar una venta, por ejemplo: " : "Mandale un mensaje al bot para cargar un gasto, por ejemplo: "}
              <span className="font-marca text-xs bg-ink/[0.06] rounded px-1 py-0.5 text-foreground whitespace-nowrap">
                {isEmployee(appUser) ? "vendí 3 empanadas" : "15000 supermercado"}
              </span>
            </p>

            {isLinked ? (
              <>
                <div className={`${SHEET_BLOCK} flex items-center gap-2`}>
                  <CheckCircle2 className="w-[18px] h-[18px] text-[#3B2FB3] shrink-0" />
                  <span className="text-[15px] text-foreground min-w-0">Vinculado: <span className="font-semibold">{formatPhone(appUser.whatsapp_phone ?? "")}</span></span>
                </div>
                <SheetSwitch title="Usar WhatsApp para los avisos" checked={!!appUser?.whatsapp_notifications}
                  disabled={savingPref} onChange={toggleWaNotifs}>
                  <span className="block mt-0.5 text-sm leading-snug text-[#4A4658]">
                    Para avisarle por WhatsApp a quien le compartís un gasto, y para
                    que te avisen a vos. El aviso dentro de la app va igual: esto es
                    un canal extra.
                  </span>
                  {/* La consecuencia que no se ve: a quien no tiene la app,
                      WhatsApp es su único canal. Decirlo acá y no cuando ya pasó. */}
                  <span className="block mt-1.5 text-sm leading-snug font-medium text-foreground">
                    Si lo apagás, a quien invites y no tenga la app no le va a llegar
                    nada.
                  </span>
                </SheetSwitch>

                {confirmUnlink ? (
                  <ConfirmInline question="¿Desvincular este número? El bot deja de reconocerte." confirmLabel="Sí, desvincular"
                    busy={loading} onConfirm={unlink} onCancel={() => setConfirmUnlink(false)} />
                ) : (
                  <button type="button" onClick={() => setConfirmUnlink(true)}
                    className="min-h-[44px] px-1.5 text-[15px] font-semibold text-destructive active:scale-[0.98] transition-transform duration-100">
                    Desvincular
                  </button>
                )}
                {error && <p role="alert" className="text-sm text-rose-800 bg-rose-50 rounded-xl px-3 py-2">{error}</p>}
              </>
            ) : (
              <WhatsAppVerifyForm onVerified={async () => { await refreshUser(); reaccionar("guardado", "WhatsApp vinculado"); }} />
            )}
          </div>
        </FormSheet>
      )}
    </>
  );
}

const memberCount = (n: number) => (n === 1 ? "sólo vos" : `${n} personas`);

/** Qué versión es y qué trajo cada una. */
function VersionSheet({ onClose }: { onClose: () => void }) {
  return (
    <FormSheet title={`tood ${APP_VERSION}`} onClose={onClose}>
      <div className={`${FORM_SHEET_BODY} !pb-4 space-y-3`}>
        {IS_BETA && (
          <p className={`${SHEET_TEXT} px-1.5`}>Es una versión de prueba. Tus datos son los reales: lo que cargues o borres acá también cambia en la app.</p>
        )}
        {CHANGELOG.map(r => (
          <section key={r.version} className={SHEET_BLOCK}>
            <div className="flex items-baseline justify-between gap-3">
              <h4 className="font-semibold text-[15.5px] text-foreground">{r.version}</h4>
              <span className="font-marca text-xs text-muted-foreground shrink-0">
                {format(parseISO(r.date), "d MMM yyyy", { locale: es }).replace(".", "")}
              </span>
            </div>
            <ul className="mt-1.5 space-y-1 text-[15px] leading-snug text-[#3F3B4B]">
              {r.notes.map(n => <li key={n}>{n}</li>)}
            </ul>
          </section>
        ))}
      </div>
    </FormSheet>
  );
}

export default function SettingsPage() {
  const reaccionar = useReaccion();
  const { appUser, firebaseUser, logout, clearUser } = useAuth();
  const [versionOpen, setVersionOpen] = useState(false);
  const router = useRouter();
  // Un negocio no tiene divisas, gastos compartidos (los avisos de hoy son de
  // eso) ni la invitación a crear un hogar propio.
  const business = isBusiness(appUser);
  const employee = isEmployee(appUser);
  const t = terms(appUser);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersState, setMembersState] = useState<"loading" | "ok" | "error">("loading");
  const [spaceOpen, setSpaceOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmKickId, setConfirmKickId] = useState<number | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Un empleado no ve el organigrama (el backend se lo niega con 403).
  const loadMembers = () => {
    if (employee) return;
    api.get("/auth/members")
      .then(r => { setMembers(r.data); setMembersState("ok"); })
      .catch(() => setMembersState("error"));
  };
  useEffect(loadMembers, [employee]);  // eslint-disable-line react-hooks/exhaustive-deps

  const runAction = async (action: () => Promise<void>) => {
    setActionLoading(true);
    setActionError(null);
    try {
      await action();
    } catch (e) {
      setActionError(getErrorMessage(e));
    } finally {
      setActionLoading(false);
    }
  };

  const setRole = (memberId: number, role: "member" | "employee") => runAction(async () => {
    await api.patch(`/auth/members/${memberId}/role`, { role });
    reaccionar("guardado", role === "member" ? "Ahora es socio" : "Ahora es empleado");
    loadMembers();
  });

  const copyId = () => {
    navigator.clipboard.writeText(appUser?.tenant_code ?? String(appUser?.tenant_id));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareHouseholdCodeByWhatsApp = () => {
    const code = appUser?.tenant_code ?? String(appUser?.tenant_id ?? "");
    const name = appUser?.display_name || appUser?.email || "Alguien";
    const appUrl = typeof window !== "undefined" ? window.location.origin : "";
    const message = buildHouseholdInviteMessage(name, code, appUrl, business);
    window.open("https://wa.me/?text=" + encodeURIComponent(message), "_blank");
  };

  const kickMember = (memberId: number) => runAction(async () => {
    await api.delete("/auth/members/" + memberId);
    setConfirmKickId(null);
    reaccionar("borrado", `Salió del ${t.space}`);
    loadMembers();
  });

  const leaveHousehold = () => runAction(async () => {
    await api.post("/auth/me/leave-household");
    clearUser();
    router.replace("/onboarding");
  });

  const spaceHint = [appUser?.tenant_name, membersState === "ok" ? memberCount(members.length) : null].filter(Boolean).join(" · ");

  return (
    <div className="space-y-5 md:space-y-6">
      <h1 className="text-[26px] md:text-3xl font-display font-medium tracking-[-0.035em] text-foreground">Configuración</h1>

      <ProfileSection />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-5 items-start [&>*]:min-w-0">
        {!employee && (
          <SettingsGroup title={business ? "Tu gente" : "Sumar gente"}>
            <SettingsRow icon={business ? Store : Home} title={t.YourSpace} hint={spaceHint} onClick={() => setSpaceOpen(true)} />
            {!business && <InviteFriendSection />}
          </SettingsGroup>
        )}

        <SettingsGroup title="WhatsApp y avisos">
          {!business && <PushNotificationsSection />}
          <WhatsAppSection />
          {/* En pausa detrás de un flag: ver lib/features.ts. */}
          {features.iosShortcut && <IosShortcutSection />}
        </SettingsGroup>

        {/* El conector lee todo el negocio: justo lo que un empleado no ve. */}
        {!employee && (
          <SettingsGroup title="Asistente de IA">
            <McpConnectorSection />
          </SettingsGroup>
        )}

        <SettingsGroup title="Preferencias">
          {!business && <CurrencySettingsSection />}
          <SettingsRow icon={BookOpen} title="Reiniciar guía" hint="Vuelven las explicaciones y las novedades"
            onClick={() => {
              resetAllTours(APP_TOUR_IDS);
              // Las novedades también vuelven a verse.
              try { localStorage.removeItem(WHATS_NEW_KEY); } catch { /* storage bloqueado */ }
              window.location.href = "/dashboard";
            }} />
        </SettingsGroup>

        <SettingsGroup title="Tu cuenta">
          <SessionRow photoURL={firebaseUser?.photoURL} email={appUser?.email} onLogout={logout}
            google={!!firebaseUser?.providerData.some(p => p.providerId === "google.com")} />
          {/* Un empleado no ve la lista de miembros, así que no sabe si queda alguien más. */}
          <AccountClosureSection othersRemain={employee ? null : members.length > 1} />
        </SettingsGroup>

        <SettingsGroup title="La app">
          <SettingsRow icon={Info} title={`tood ${APP_VERSION}`}
            hint={BUILD_DATE ? `Actualizada el ${BUILD_DATE}. Qué cambió` : "Qué cambió"}
            onClick={() => setVersionOpen(true)} />
        </SettingsGroup>
      </div>

      {versionOpen && <VersionSheet onClose={() => setVersionOpen(false)} />}

      {spaceOpen && !employee && (
        <FormSheet title={t.YourSpace} onClose={() => { setSpaceOpen(false); setConfirmKickId(null); setConfirmLeave(false); setActionError(null); }}>
          <div className={`${FORM_SHEET_BODY} !pb-4`}>
            <p className={`${SHEET_TEXT} px-1.5`}>
              {business
                ? "Quien se suma con este código entra como empleado: carga ventas y stock, sin ver los números del negocio. Desde acá lo podés hacer socio."
                : "Sumá miembros a tu hogar compartiendo este código."}
            </p>
            <div className={SHEET_BLOCK}>
              <p className="text-xs text-[#4A4658]">{t.spaceCode}</p>
              <p className="mt-0.5 font-marca text-[26px] text-[#3B2FB3] tracking-[0.12em]">{appUser?.tenant_code ?? appUser?.tenant_id}</p>
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={copyId} className="h-11">
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? "Copiado" : "Copiar"}
                </Button>
                <Button variant="outline" onClick={shareHouseholdCodeByWhatsApp} className="h-11">
                  <MessageCircle className="w-4 h-4" />
                  WhatsApp
                </Button>
              </div>
            </div>

            <div>
              <h4 className="px-1.5 text-[15px] font-medium text-[#4A4658]">Miembros</h4>
              {membersState === "loading" && <p className={`${SHEET_TEXT} px-1.5 py-2`}>Cargando…</p>}
              {membersState === "error" && (
                <div className="px-1.5 py-2">
                  <p className={SHEET_TEXT}>No se pudo cargar la lista.</p>
                  <button type="button" onClick={loadMembers} className="min-h-[44px] text-[15px] font-semibold text-foreground underline underline-offset-2">Reintentar</button>
                </div>
              )}
              <MotionList className="divide-y divide-ink/[0.08]">
                {members.map(m => {
                  const canChangeRole = business && appUser?.role === "admin" && m.role !== "admin";
                  const canKick = appUser?.role === "admin" && m.id !== appUser?.id;
                  const canLeave = m.id === appUser?.id && members.length > 1;
                  return (
                    <div key={m.id} className="px-1.5 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          {/* `truncate`: un mail largo como nombre no corta en espacios y se
                              metía debajo de lo de la derecha. */}
                          <p className="text-[15px] font-semibold text-foreground truncate">
                            {m.display_name || m.email}
                            {m.id === appUser?.id && <span className="ml-1.5 font-normal text-[#4A4658]">(vos)</span>}
                          </p>
                          {m.display_name && <p className="text-sm text-[#4A4658] truncate">{m.email}</p>}
                        </div>
                        <Chip tone="neutral" className="shrink-0">{roleLabel(appUser, m.role)}</Chip>
                      </div>
                      {(canChangeRole || canKick || canLeave) && (
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-4 -mb-1.5">
                          {canChangeRole && (
                            <button type="button" onClick={() => setRole(m.id, m.role === "employee" ? "member" : "employee")} disabled={actionLoading}
                              className="min-h-[44px] text-sm font-semibold text-[#3B2FB3] disabled:opacity-50">
                              {m.role === "employee" ? "Hacer socio" : "Pasar a empleado"}
                            </button>
                          )}
                          {canKick && confirmKickId !== m.id && (
                            <button type="button" onClick={() => setConfirmKickId(m.id)}
                              className="min-h-[44px] text-sm font-semibold text-destructive">
                              {`Eliminar del ${t.space}`}
                            </button>
                          )}
                          {canLeave && !confirmLeave && (
                            <button type="button" onClick={() => setConfirmLeave(true)}
                              className="min-h-[44px] text-sm font-semibold text-destructive">
                              Salir
                            </button>
                          )}
                        </div>
                      )}
                      {canKick && confirmKickId === m.id && (
                        <div className="mt-2 mb-1">
                          <ConfirmInline question={`¿Sacar a ${m.display_name || m.email} del ${t.space}?`} confirmLabel="Sí, sacar"
                            busy={actionLoading} onConfirm={() => kickMember(m.id)} onCancel={() => setConfirmKickId(null)} />
                        </div>
                      )}
                      {canLeave && confirmLeave && (
                        <div className="mt-2 mb-1">
                          <ConfirmInline question={`¿Salir de ${t.yourSpace}?`} confirmLabel="Sí, salir"
                            busy={actionLoading} onConfirm={leaveHousehold} onCancel={() => setConfirmLeave(false)} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </MotionList>
            </div>
            {actionError && <p role="alert" className="text-sm text-rose-800 bg-rose-50 rounded-xl px-3 py-2">{actionError}</p>}
          </div>
        </FormSheet>
      )}
    </div>
  );
}
