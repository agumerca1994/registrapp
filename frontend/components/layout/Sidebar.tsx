"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, TrendingUp, TrendingDown, BarChart3,
  Home, LogOut, Settings, MoreHorizontal, Users2, CreditCard, CalendarDays,
  CircleUserRound,
} from "lucide-react";
import pkg from "../../package.json";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, tour: "nav-dashboard" },
  { href: "/income", label: "Ingresos", icon: TrendingUp, tour: "nav-income" },
  { href: "/expenses", label: "Egresos", icon: TrendingDown, tour: "nav-expenses" },
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
const mobileTabs = nav.filter((item) => MOBILE_TAB_HREFS.includes(item.href));
const moreItems = nav.filter((item) => !MOBILE_TAB_HREFS.includes(item.href));

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

  return (
    <>
      <div className="p-6 border-b">
        <h1 className="text-xl font-display font-bold text-primary">RegistrApp</h1>
        <p className="text-xs text-muted-foreground mt-1 truncate">
          {greeting(appUser?.display_name, appUser?.email)}
        </p>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {nav.map(({ href, label, icon: Icon, tour }) => (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            data-tour={tour}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              pathname === href
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent"
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
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
                  pathname === href
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-accent"
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
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
  const isMoreActive = moreItems.some((item) => item.href === pathname);

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
        {mobileTabs.map(({ href, label, icon: Icon, tour }) => {
          const active = pathname === href;
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
              <Icon className="w-5 h-5" />
              {label}
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
          <MoreHorizontal className="w-5 h-5" />
          Más
        </button>
      </nav>

      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
    </>
  );
}
