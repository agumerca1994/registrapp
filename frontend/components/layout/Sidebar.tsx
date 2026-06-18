"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, TrendingUp, TrendingDown, BarChart3,
  Home, LogOut, Settings
} from "lucide-react";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/income", label: "Ingresos", icon: TrendingUp },
  { href: "/expenses", label: "Egresos", icon: TrendingDown },
  { href: "/macro", label: "Variables macro", icon: BarChart3 },
  { href: "/mortgage", label: "Hipoteca", icon: Home },
  { href: "/settings", label: "Configuración", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { appUser, logout } = useAuth();

  return (
    <aside className="w-60 h-screen bg-white border-r flex flex-col sticky top-0">
      <div className="p-6 border-b">
        <h1 className="text-xl font-bold text-primary">RegistrApp</h1>
        <p className="text-xs text-muted-foreground mt-1 truncate">
          {appUser?.display_name || appUser?.email}
        </p>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
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

      <div className="p-4 border-t space-y-1">
        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 w-full transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
