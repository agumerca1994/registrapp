"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePendingShared } from "@/contexts/PendingSharedContext";
import { usePendingStatements } from "@/contexts/PendingStatementsContext";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, TrendingUp, TrendingDown, BarChart3,
  Home, LogOut, Settings, MoreHorizontal, Users2, CreditCard, CalendarDays,
  CircleUserRound, ArrowLeftRight, Contact, ShoppingBag, Package,
} from "lucide-react";
import { isBusiness, isEmployee } from "@/lib/account";
import pkg from "../../package.json";

interface NavItem {
  href: string;
  label: string;
  // Para la tab bar del celular, donde no entra un label largo.
  short?: string;
  icon: React.ElementType;
  tour?: string;
}

// El del hogar no se toca: orden, labels y `data-tour` son los que esperan la
// guía del dashboard y los baselines visuales.
const nav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, tour: "nav-dashboard" },
  { href: "/income", label: "Ingresos", icon: TrendingUp, tour: "nav-income" },
  { href: "/expenses", label: "Egresos", icon: TrendingDown, tour: "nav-expenses" },
  { href: "/divisas", label: "Divisas", icon: ArrowLeftRight, tour: "nav-divisas" },
  { href: "/shared", label: "Gastos compartidos", icon: Users2, tour: "nav-shared" },
  { href: "/tarjetas", label: "Tarjetas", icon: CreditCard, tour: "nav-tarjetas" },
  { href: "/calendario", label: "Calendario de pagos", icon: CalendarDays, tour: "nav-calendario" },
  { href: "/mortgage", label: "Hipoteca", icon: Home },
  { href: "/macro", label: "Variables macro", icon: BarChart3 },
  { href: "/settings", label: "Configuración", icon: Settings },
];

// Bottom tab bar (mobile only) surfaces these 4 directly; everything else in
// `nav` lives behind "Más". Order/membership confirmed with the user.
const MOBILE_TAB_HREFS = ["/dashboard", "/income", "/expenses", "/tarjetas"];

// Un negocio ve sólo lo que tiene sentido en un comercio: sin divisas,
// hipoteca, compartidos ni macro (las rutas, en lib/account.ts). En la tab bar
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
function isNavActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(href + "/");
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

const BUILD_DATE = process.env.NEXT_PUBLIC_BUILD_DATE
  ? new Date(process.env.NEXT_PUBLIC_BUILD_DATE).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
  : null;

function greeting(displayName?: string | null, email?: string | null): string {
  const firstName = displayName?.trim().split(/\s+/)[0] || email?.split("@")[0];
  return firstName ? `¡Bienvenido de nuevo, ${firstName}!` : "¡Bienvenido de nuevo!";
}

function Avatar({ photoURL, className }: { photoURL?: string | null; className?: string }) {
  const [errored, setErrored] = useState(false);
  if (photoURL && !errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoURL}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setErrored(true)}
        className={cn("rounded-full border-2 border-ink object-cover shrink-0", className)}
      />
    );
  }
  return (
    <div className={cn("rounded-full border-2 border-ink bg-accent text-primary flex items-center justify-center shrink-0", className)}>
      <CircleUserRound className="w-[65%] h-[65%]" />
    </div>
  );
}

function VersionInfo() {
  return (
    <div className="px-1 py-0.5">
      <p className="text-xs text-muted-foreground">Versión {pkg.version}</p>
      {BUILD_DATE && <p className="text-xs text-muted-foreground mt-0.5">Actualizado el {BUILD_DATE}</p>}
    </div>
  );
}

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { appUser, firebaseUser, logout } = useAuth();
  // Hay que llamar al hook acá, no leer el contexto por otro lado: las
  // pantallas llegan como children del provider y React no las re-renderiza
  // cuando cambia su estado. Esto es lo que suscribe al puntito.
  const pendingHrefs = usePendingHrefs();
  const { items } = useNav();

  return (
    <>
      <div className="p-6 border-b">
        <h1 className="text-xl font-display font-bold text-primary">RegistrApp</h1>
        <p className="text-xs text-muted-foreground mt-1 truncate">
          {greeting(appUser?.display_name, appUser?.email)}
        </p>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {items.map(({ href, label, icon: Icon, tour }) => (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            data-tour={tour}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              isNavActive(pathname, href)
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent"
            )}
          >
            <Icon className="w-4 h-4" />
            <span className="flex-1 min-w-0">{label}</span>
            {pendingHrefs.has(href) && <NavDot />}
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent transition-colors w-full text-left">
              <Avatar photoURL={firebaseUser?.photoURL} className="w-8 h-8" />
              <span className="text-xs text-muted-foreground truncate min-w-0">
                {appUser?.email}
              </span>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="top"
              align="start"
              sideOffset={8}
              className="bg-card border rounded-xl shadow-lg p-3 w-56 z-50"
            >
              <VersionInfo />
              <DropdownMenu.Separator className="h-px bg-border my-2" />
              <DropdownMenu.Item asChild>
                <button
                  onClick={logout}
                  className="flex items-center gap-2 px-1 py-1.5 rounded-lg text-sm font-medium text-destructive hover:bg-destructive/10 w-full outline-none cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  Cerrar sesión
                </button>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </>
  );
}

function MoreSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const pathname = usePathname();
  const { appUser, firebaseUser, logout } = useAuth();
  const pendingHrefs = usePendingHrefs();
  const { moreItems } = useNav();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="md:hidden fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card rounded-t-2xl border-t max-h-[80vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]"
        >
          <Dialog.Title className="sr-only">Más opciones</Dialog.Title>
          <div className="flex justify-center pt-2.5 pb-1">
            <div className="w-10 h-1 rounded-full bg-border" />
          </div>
          <div className="p-4 pt-2 space-y-1">
            {moreItems.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => onOpenChange(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isNavActive(pathname, href)
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-accent"
                )}
              >
                <Icon className="w-4 h-4" />
                <span className="flex-1 min-w-0">{label}</span>
                {pendingHrefs.has(href) && <NavDot />}
              </Link>
            ))}

            <div className="mt-2 pt-3 border-t flex items-center gap-3 px-1">
              <Avatar photoURL={firebaseUser?.photoURL} className="w-9 h-9" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{appUser?.email}</p>
                <p className="text-xs text-muted-foreground">
                  Versión {pkg.version}{BUILD_DATE && ` · ${BUILD_DATE}`}
                </p>
              </div>
            </div>
            <button
              onClick={() => { onOpenChange(false); logout(); }}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-destructive hover:bg-destructive/10 w-full transition-colors mt-1"
            >
              <LogOut className="w-4 h-4" />
              Cerrar sesión
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function Sidebar() {
  const [moreOpen, setMoreOpen] = useState(false);
  const pathname = usePathname();
  const { appUser } = useAuth();
  const pendingHrefs = usePendingHrefs();
  const { mobileTabs, moreItems } = useNav();
  const isMoreActive = moreItems.some((item) => isNavActive(pathname, item.href));

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 h-screen bg-card border-r flex-col sticky top-0 shrink-0">
        <NavContent />
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-card border-b flex flex-col justify-center px-4 h-16">
        <span className="text-base font-display font-bold text-primary leading-tight">RegistrApp</span>
        <span className="text-xs text-muted-foreground leading-tight truncate">
          {greeting(appUser?.display_name, appUser?.email)}
        </span>
      </div>

      {/* Mobile bottom tab bar — floating, matching the hero-card treatment
          (thick border + hard shadow) instead of a flat edge-to-edge strip. */}
      <nav
        className="md:hidden fixed left-3 right-3 z-40 bg-card border-[2.5px] border-ink rounded-2xl shadow-hero flex items-stretch h-[68px] px-1"
        style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        {mobileTabs.map(({ href, label, short, icon: Icon, tour }) => {
          const active = isNavActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              data-tour={tour}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-1 text-xs font-medium transition-colors rounded-xl m-1",
                active ? "text-primary bg-accent" : "text-muted-foreground"
              )}
            >
              {/* Mismo criterio que el de "Más": el puntito sobre el icono. */}
              <span className="relative">
                <Icon className="w-5 h-5" />
                {pendingHrefs.has(href) && <NavDot className="absolute -top-0.5 -right-1" />}
              </span>
              {short ?? label}
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen(true)}
          className={cn(
            "flex-1 flex flex-col items-center justify-center gap-1 text-xs font-medium transition-colors rounded-xl m-1",
            isMoreActive ? "text-primary bg-accent" : "text-muted-foreground"
          )}
        >
          {/* El puntito sobre el icono, no al lado del texto: en la tab bar el
              icono es lo que se mira, y colgarlo del texto descentra el tab. */}
          <span className="relative">
            <MoreHorizontal className="w-5 h-5" />
            {moreItems.some((item) => pendingHrefs.has(item.href)) && (
              <NavDot className="absolute -top-0.5 -right-1" />
            )}
          </span>
          Más
        </button>
      </nav>

      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
    </>
  );
}
