"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/expenses", label: "Egresos" },
  { href: "/income", label: "Ingresos" },
];

/** Qué mira el desglose y la tabla de Movimientos. El mes y la tarjeta quedan arriba, comunes a las dos. */
export function MovimientosTabs({ title }: { title: string }) {
  const pathname = usePathname();
  const index = Math.max(0, TABS.findIndex(t => t.href === pathname));
  return (
    <div>
      {/* Las pestañas ya dicen dónde estás; el encabezado queda para un lector de pantalla. */}
      <h2 className="sr-only">{title}</h2>
      <nav aria-label="Egresos o ingresos" className="relative inline-grid grid-cols-2 p-1 rounded-full bg-secondary">
        {/* Cada pestaña es otra ruta y esto se vuelve a montar: arranca desde la otra. */}
        <span aria-hidden="true" className="animate-thumb-slide absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-card shadow-sm"
          style={{ transform: `translateX(${index * 100}%)`, "--thumb-from": `${(1 - index) * 100}%` } as React.CSSProperties} />
        {TABS.map(({ href, label }) => {
          const active = pathname === href;
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined}
              className={`relative px-5 py-2 rounded-full text-sm font-semibold text-center transition-colors ${
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}>
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
