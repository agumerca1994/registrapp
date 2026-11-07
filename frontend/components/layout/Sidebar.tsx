"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { ToodLogo } from "@/components/brand/ToodLogo";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePendingShared } from "@/contexts/PendingSharedContext";
import { usePendingStatements } from "@/contexts/PendingStatementsContext";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import * as Dialog from "@radix-ui/react-dialog";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api";
import { cn, formatUSD } from "@/lib/utils";
import {
  LayoutDashboard, TrendingDown, BarChart3, ArrowDownUp, Plus,
  Landmark, Target, TrendingUp, Settings, MoreHorizontal, Users2, CreditCard, CalendarDays,
  ArrowLeftRight, Contact, ShoppingBag, Package,
} from "lucide-react";
import { isBusiness, isEmployee } from "@/lib/account";
import { AddSheet } from "@/components/layout/AddSheet";
import { GoogleAvatar } from "@/components/account/GoogleAvatar";
import { useOverlay } from "@/lib/overlay";
import { GLASS_LIGHT, GLASS_SHEET } from "@/components/ui/glass";

interface NavItem {
  href: string;
  label: string;
  // Para la tab bar del celular, donde no entra un label largo.
  short?: string;
  icon: React.ElementType;
  tour?: string;
  // Otras rutas que también marcan este ítem como activo.
  also?: string[];
}

// Los `data-tour` son los que espera la guía de Inicio.
const nav: NavItem[] = [
  { href: "/dashboard", label: "Inicio", icon: LayoutDashboard, tour: "nav-dashboard" },
  { href: "/expenses", label: "Movimientos", icon: ArrowDownUp, tour: "nav-movimientos", also: ["/income"] },
  { href: "/divisas", label: "Divisas", icon: ArrowLeftRight, tour: "nav-divisas" },
  { href: "/objetivos", label: "Objetivos", icon: Target, also: ["/ahorro"] },
  { href: "/inversiones", label: "Inversiones", icon: TrendingUp },
  { href: "/shared", label: "Gastos compartidos", icon: Users2, tour: "nav-shared" },
  { href: "/tarjetas", label: "Tarjetas", icon: CreditCard, tour: "nav-tarjetas" },
  { href: "/calendario", label: "Calendario de pagos", icon: CalendarDays, tour: "nav-calendario" },
  { href: "/creditos", label: "Créditos", icon: Landmark, also: ["/mortgage"] },
  { href: "/macro", label: "Variables macro", icon: BarChart3 },
  { href: "/settings", label: "Configuración", icon: Settings },
];

// Bottom tab bar (mobile only) surfaces these directly, con el + en el medio;
// everything else in `nav` lives behind "Más".
const MOBILE_TAB_HREFS = ["/dashboard", "/expenses", "/tarjetas"];

// Un negocio ve sólo lo que tiene sentido en un comercio: sin divisas,
// créditos, objetivos, inversiones, compartidos ni macro (las rutas, en lib/account.ts). En la tab bar
// va lo de todos los días: vender, gastar y los productos.
const BUSINESS_NAV: NavItem[] = [
  { href: "/dashboard", label: "Inicio", icon: LayoutDashboard },
  { href: "/ventas", label: "Ventas", icon: ShoppingBag },
  { href: "/expenses", label: "Egresos", icon: TrendingDown },
  { href: "/productos", label: "Productos", icon: Package },
  { href: "/proveedores", label: "Proveedores y empleados", short: "Proveedores", icon: Contact },
  { href: "/tarjetas", label: "Tarjetas", icon: CreditCard },
  { href: "/calendario", label: "Calendario de pagos", icon: CalendarDays },
  { href: "/settings", label: "Configuración", icon: Settings },
];
const BUSINESS_TAB_HREFS = ["/dashboard", "/ventas", "/expenses", "/productos"];

// Un empleado ve sólo lo que carga: ventas y productos (lib/account.ts).
const EMPLOYEE_NAV: NavItem[] = [
  { href: "/ventas", label: "Ventas", icon: ShoppingBag },
  { href: "/productos", label: "Productos", icon: Package },
  { href: "/settings", label: "Configuración", icon: Settings },
];
const EMPLOYEE_TAB_HREFS = ["/ventas", "/productos", "/settings"];

// Un hook y no constantes de módulo: qué se muestra depende del usuario.
// Las tres superficies (sidebar, tab bar, hoja "Más") lo llaman, así no
// pueden discrepar.
function useNav() {
  const { appUser } = useAuth();
  const business = isBusiness(appUser);
  const employee = isEmployee(appUser);
  const items = employee ? EMPLOYEE_NAV : business ? BUSINESS_NAV : nav;
  const tabs = employee ? EMPLOYEE_TAB_HREFS : business ? BUSINESS_TAB_HREFS : MOBILE_TAB_HREFS;
  return {
    items,
    mobileTabs: items.filter((item) => tabs.includes(item.href)),
    moreItems: items.filter((item) => !tabs.includes(item.href)),
  };
}

// Activo también en las subrutas (/tarjetas/resumenes, /tarjetas/3/12): una
// pantalla que cuelga de una sección no puede dejar la navegación sin nada
// marcado. El "/" final evita que /income marque algo como /incomes.
function isNavActive(pathname: string | null, href: string, also: string[] = []): boolean {
  if (!pathname) return false;
  return [href, ...also].some((h) => pathname === h || pathname.startsWith(h + "/"));
}

// Ámbar y no rojo: es lo que la app ya usa para "pendiente" (el chip de
// /shared), y esto no es un error, es una decisión esperando. El anillo del
// color de la tarjeta lo despega tanto del fondo blanco como del violeta del
// ítem activo, que si no se lo come.
function NavDot({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`w-2 h-2 rounded-full bg-amber-500 ring-2 ring-card shrink-0 ${className}`}
    />
  );
}

// Un solo lugar decide qué ítem lleva el aviso, así el sidebar, la hoja "Más"
// y la tab bar no pueden discrepar: /shared por los gastos compartidos
// esperando decisión, /tarjetas por los resúmenes subidos a medio revisar.
// Cada componente que pinta el puntito llama a este hook (no lo recibe por
// props): las pantallas llegan como children de los providers y React no las
// re-renderiza cuando cambia su estado.
function usePendingHrefs(): Set<string> {
  const { count: sharedCount } = usePendingShared();
  const { count: statementsCount } = usePendingStatements();
  const hrefs = new Set<string>();
  if (sharedCount > 0) hrefs.add("/shared");
  if (statementsCount > 0) hrefs.add("/tarjetas");
  return hrefs;
}

function greeting(displayName?: string | null, email?: string | null): string {
  const firstName = displayName?.trim().split(/\s+/)[0] || email?.split("@")[0];
  return firstName ? `Hola, ${firstName}` : "Hola";
}

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { appUser, firebaseUser } = useAuth();
  // Hay que llamar al hook acá, no leer el contexto por otro lado: las
  // pantallas llegan como children del provider y React no las re-renderiza
  // cuando cambia su estado. Esto es lo que suscribe al puntito.
  const pendingHrefs = usePendingHrefs();
  const { items } = useNav();

  return (
    <>
      <div className="p-6 border-b">
        <h1><ToodLogo className="h-7 w-auto text-primary" title="tood" /></h1>
        <p className="text-xs text-muted-foreground mt-1 truncate">
          {greeting(appUser?.display_name, appUser?.email)}
        </p>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {items.map(({ href, label, icon: Icon, tour, also }) => (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            data-tour={tour}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              isNavActive(pathname, href, also)
                ? "bg-accent text-[#3B2FB3] font-semibold"
                : "text-muted-foreground hover:bg-accent"
            )}
          >
            <Icon className="w-4 h-4" />
            <span className="flex-1 min-w-0">{label}</span>
            {pendingHrefs.has(href) && <NavDot />}
          </Link>
        ))}
      </nav>

      {/* Cerrar sesión y la versión están en Configuración: acá sólo con qué cuenta entraste. */}
      <div className="p-4 border-t">
        <Link href="/settings" onClick={onNavigate}
          className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent transition-colors w-full text-left">
          <GoogleAvatar photoURL={firebaseUser?.photoURL} className="w-8 h-8" />
          <span className="text-xs text-muted-foreground truncate min-w-0">{appUser?.email}</span>
        </Link>
      </div>
    </>
  );
}

// Lo que dice cada tarjeta de "Más" si no hay un dato mejor.
const MORE_HINTS: Record<string, string> = {
  "/divisas": "Tus dólares",
  "/shared": "Dividir gastos",
  "/calendario": "Vencimientos",
  "/objetivos": "Para qué juntás",
  "/inversiones": "Cuánto vale hoy",
  "/creditos": "Préstamos y cuotas",
  "/macro": "Dólar e inflación",
  "/settings": "Cuenta y avisos",
  "/proveedores": "A quién le pagás",
  "/tarjetas": "Resúmenes y cuotas",
};

interface MoreToday {
  usd_holding: string;
  usd_rate: string | null;
  usd_rate_type: string;
  upcoming: { kind: string; date: string; detail: string | null }[];
}

/**
 * "Más": cada sección dice algo de lo tuyo, así hay un motivo para entrar. Pide
 * el dato recién al abrirse. Si falla, cada tarjeta queda con su texto fijo.
 */
function MoreSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  useAmountsHidden();  // repinta la hoja al ocultar/mostrar montos
  useOverlay(open);
  const pathname = usePathname();
  const { appUser } = useAuth();
  const pendingHrefs = usePendingHrefs();
  const { count: sharedCount } = usePendingShared();
  const { moreItems } = useNav();
  const [today, setToday] = useState<MoreToday | null>(null);
  const household = !isBusiness(appUser);

  useEffect(() => {
    if (!open || !household) return;
    api.get<MoreToday>("/dashboard/today").then(({ data }) => setToday(data)).catch(() => {});
  }, [open, household]);

  const hint = (href: string): string => {
    if (href === "/shared" && sharedCount > 0) return `${sharedCount} para resolver`;
    if (today) {
      if (href === "/divisas" && Number(today.usd_holding) > 0) return `${formatUSD(today.usd_holding).replace(/,00$/, "")} guardados`;
      if (href === "/calendario" && today.upcoming[0]) return `Próximo: ${format(parseISO(today.upcoming[0].date), "d MMM", { locale: es }).replace(".", "")}`;
      if (href === "/creditos") {
        const cuota = today.upcoming.find(i => i.kind === "mortgage")?.detail;
        if (cuota) return cuota;
      }
      // Dato público, no de la cuenta: no se oculta con los montos.
      if (href === "/macro" && today.usd_rate) {
        return `Dólar ${today.usd_rate_type} $ ${Math.round(Number(today.usd_rate)).toLocaleString("es-AR")}`;
      }
    }
    return MORE_HINTS[href] ?? "";
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="md:hidden fixed inset-0 z-50 bg-ink/30 animate-fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          className={`md:hidden fixed left-2.5 right-2.5 z-50 max-h-[85vh] overflow-y-auto overscroll-contain rounded-[34px] ${GLASS_SHEET} shadow-flota px-3 pt-2.5 pb-3 animate-sheet-in`}
          style={{ bottom: "calc(0.625rem + env(safe-area-inset-bottom))" }}
        >
          <div className="w-10 h-1 rounded-full bg-ink/20 mx-auto mb-3" />
          <Dialog.Title className="sr-only">Más opciones</Dialog.Title>

          <div className="grid grid-cols-2 gap-2">
            {moreItems.map(({ href, label, short, icon: Icon }) => {
              const active = isNavActive(pathname, href);
              const pending = pendingHrefs.has(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => onOpenChange(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative min-h-[104px] rounded-[22px] p-3 flex flex-col justify-between gap-2 border transition-transform duration-100 active:scale-[0.97] last:odd:col-span-2",
                    active ? "bg-accent border-[#CFC9E4]" : "bg-white/70 border-white/80"
                  )}
                >
                  <span className="flex items-start justify-between">
                    <span className="w-[38px] h-[38px] rounded-full bg-accent text-[#3B2FB3] flex items-center justify-center">
                      <Icon className="w-[19px] h-[19px]" strokeWidth={1.8} />
                    </span>
                    {pending && <NavDot className="mt-1 mr-1" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-[15px] leading-tight text-foreground truncate">{short ?? label}</span>
                    <span className={cn("block mt-0.5 text-[13px] truncate", pending ? "font-medium text-amber-800" : "text-[#4A4658]")}>{hint(href)}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function Sidebar() {
  const [moreOpen, setMoreOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const pathname = usePathname();
  const { appUser } = useAuth();
  const pendingHrefs = usePendingHrefs();
  const { mobileTabs, moreItems } = useNav();
  const isMoreActive = moreItems.some((item) => isNavActive(pathname, item.href));
  // Un negocio tiene cuatro pestañas y su propio + en cada pantalla; un hogar, tres y el + en el medio.
  const household = !isBusiness(appUser);
  const tabLink = ({ href, label, short, icon: Icon, tour, also }: NavItem) => {
    const active = isNavActive(pathname, href, also);
    return (
      <Link
        key={href}
        href={href}
        data-tour={tour}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 text-[11.5px] font-medium transition-colors rounded-full my-1.5",
          active ? "text-[#3B2FB3] font-semibold bg-white" : "text-[#3F3B4B]"
        )}
      >
        {/* Mismo criterio que el de "Más": el puntito sobre el icono. */}
        <span className="relative">
          <Icon className="w-[22px] h-[22px]" strokeWidth={1.8} />
          {pendingHrefs.has(href) && <NavDot className="absolute -top-0.5 -right-1" />}
        </span>
        {short ?? label}
      </Link>
    );
  };

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 h-screen bg-card border-r flex-col sticky top-0 shrink-0">
        <NavContent />
      </aside>

      {/* Mobile top bar. Inicio no la lleva: su encabezado es el bloque violeta. */}
      {pathname !== "/dashboard" && (
        <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-background/95 supports-[backdrop-filter]:bg-background/55 backdrop-blur-xl backdrop-saturate-[1.8] border-b border-ink/[0.06] flex flex-col justify-center px-4 h-16">
          <ToodLogo className="h-5 w-auto text-primary self-start" title="tood" />
          <span className="text-xs text-muted-foreground leading-tight truncate">
            {greeting(appUser?.display_name, appUser?.email)}
          </span>
        </div>
      )}

      {/* Barra flotante de vidrio: lo que pasa por debajo se ve desenfocado.
          Sin soporte de backdrop-filter queda casi opaca, para que se siga leyendo. */}
      <nav
        className={`md:hidden fixed left-3 right-3 z-40 ${GLASS_LIGHT} rounded-full shadow-flota flex items-stretch h-[70px] px-1.5`}
        style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        {(household ? mobileTabs.slice(0, 2) : mobileTabs).map(tabLink)}
        {household && (
          <button
            onClick={() => setAddOpen(true)}
            aria-label="Agregar"
            data-tour="nav-add"
            className="shrink-0 self-center mx-0.5 w-14 h-14 rounded-full bg-ink text-background flex items-center justify-center active:scale-[0.95] transition-transform duration-100"
          >
            <Plus className="w-6 h-6" strokeWidth={2.2} />
          </button>
        )}
        {household && mobileTabs.slice(2).map(tabLink)}
        <button
          onClick={() => setMoreOpen(true)}
          className={cn(
            "flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 text-[11.5px] font-medium transition-colors rounded-full my-1.5",
            isMoreActive ? "text-[#3B2FB3] font-semibold bg-white" : "text-[#3F3B4B]"
          )}
        >
          {/* El puntito sobre el icono, no al lado del texto: en la tab bar el
              icono es lo que se mira, y colgarlo del texto descentra el tab. */}
          <span className="relative">
            <MoreHorizontal className="w-[22px] h-[22px]" strokeWidth={1.8} />
            {moreItems.some((item) => pendingHrefs.has(item.href)) && (
              <NavDot className="absolute -top-0.5 -right-1" />
            )}
          </span>
          Más
        </button>
      </nav>

      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
      {household && <AddSheet open={addOpen} onOpenChange={setAddOpen} />}
    </>
  );
}
