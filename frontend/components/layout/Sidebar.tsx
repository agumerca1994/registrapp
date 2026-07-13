"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, TrendingUp, TrendingDown, BarChart3,
  Home, LogOut, Settings, Menu, X, Users2, CreditCard, CalendarDays,
} from "lucide-react";

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

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { appUser, logout } = useAuth();

  return (
    <>
      <div className="p-6 border-b">
        <h1 className="text-xl font-bold text-primary">RegistrApp</h1>
        <p className="text-xs text-muted-foreground mt-1 truncate">
          {appUser?.display_name || appUser?.email}
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
                ? "bg-primary text-white"
                : "text-gray-600 hover:bg-gray-100"
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t">
        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 w-full transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Cerrar sesión
        </button>
      </div>
    </>
  );
}

export default function Sidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 h-screen bg-white border-r flex-col sticky top-0 shrink-0">
        <NavContent />
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b flex items-center px-4 h-14">
        <button onClick={() => setOpen(true)} className="p-2 -ml-2 text-gray-600">
          <Menu className="w-5 h-5" />
        </button>
        <span className="ml-2 text-lg font-bold text-primary">RegistrApp</span>
      </div>

      {/* Mobile drawer overlay */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/40"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside className={cn(
        "md:hidden fixed top-0 left-0 h-full w-72 bg-white z-50 flex flex-col transition-transform duration-300",
        open ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex items-center justify-between px-4 h-14 border-b">
          <span className="text-lg font-bold text-primary">RegistrApp</span>
          <button onClick={() => setOpen(false)} className="p-2 text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex flex-col flex-1 overflow-hidden">
          <NavContent onNavigate={() => setOpen(false)} />
        </div>
      </aside>
    </>
  );
}
