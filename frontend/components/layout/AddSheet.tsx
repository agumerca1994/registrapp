"use client";

import { usePathname, useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight } from "lucide-react";
import { features } from "@/lib/features";
import { pedirNuevo } from "@/lib/nuevo";
import { useOverlay } from "@/lib/overlay";
import { GLASS_SHEET } from "@/components/ui/glass";

// Lo que se puede cargar, en el orden en que pasa: gastar es lo de todos los días.
// `form` es la ruta cuyo formulario se abre; si ya estás en ella, se avisa con un evento.
const SECONDARY: { label: string; href: string; form?: string }[] = [
  { label: "Compartí un gasto", href: "/shared?nuevo=1", form: "/shared" },
  { label: "Compré o vendí dólares", href: "/divisas?nuevo=1", form: "/divisas" },
  ...(features.reconcile ? [{ label: "Subir el resumen de una tarjeta", href: "/tarjetas/resumenes" }] : []),
  { label: "Agregar un recordatorio", href: "/calendario?nuevo=1", form: "/calendario" },
];

// Lo que se agrega en la pantalla donde estás. Va primero y en negro: quien toca
// el + en Objetivos busca crear un objetivo, y antes no lo encontraba acá.
const HERE: Record<string, { label: string; hint: string }> = {
  "/objetivos": { label: "Nuevo objetivo", hint: "Algo para lo que querés juntar" },
  "/inversiones": { label: "Nueva inversión", hint: "Plazo fijo, fondo, acciones o cripto" },
  "/creditos": { label: "Agregar un crédito", hint: "Un préstamo que estás pagando" },
  "/tarjetas": { label: "Nueva tarjeta", hint: "Para cargarle consumos y resúmenes" },
  "/shared": { label: "Compartí un gasto", hint: "Dividilo con alguien" },
  "/divisas": { label: "Compré o vendí dólares", hint: "O ajustá lo que tenés" },
  "/calendario": { label: "Agregar un recordatorio", hint: "Un pago que no querés olvidar" },
};

/** La hoja que abre el + de la barra, en cualquier pantalla de un hogar. */
export function AddSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const pathname = usePathname();
  // Sólo en el celular: en la compu el + no abre esta hoja.
  useOverlay(open);
  const here = HERE[pathname];

  const go = (href: string, form?: string) => {
    onOpenChange(false);
    if (form && pathname === form) pedirNuevo();
    else router.push(href);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="md:hidden fixed inset-0 z-50 bg-ink/30 animate-fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          className={`md:hidden fixed left-2.5 right-2.5 z-50 rounded-[34px] ${GLASS_SHEET} shadow-flota px-3.5 pt-2.5 pb-4 animate-sheet-in`}
          style={{ bottom: "calc(0.625rem + env(safe-area-inset-bottom))" }}
        >
          <div className="w-10 h-1 rounded-full bg-ink/20 mx-auto mb-3.5" />
          <Dialog.Title className="mx-1.5 mb-3.5 text-[28px] font-medium tracking-[-0.035em]">¿Qué pasó?</Dialog.Title>

          {here && (
            <button onClick={() => { onOpenChange(false); pedirNuevo(); }}
              className="w-full min-h-[68px] rounded-[22px] bg-ink text-background flex items-center justify-between gap-3 pl-[18px] pr-3 text-left active:scale-[0.98] transition-transform duration-100">
              <span>
                <span className="block font-semibold text-lg leading-tight">{here.label}</span>
                <span className="block text-sm text-background/80">{here.hint}</span>
              </span>
              <span className="w-[42px] h-[42px] rounded-full bg-background text-ink flex items-center justify-center shrink-0">
                <ArrowRight className="w-[18px] h-[18px]" />
              </span>
            </button>
          )}

          {/* Con una acción de la pantalla arriba, los dos de siempre bajan un escalón. */}
          <button onClick={() => go("/expenses?nuevo=1", "/expenses")}
            className={`w-full rounded-[22px] flex items-center justify-between gap-3 pl-[18px] pr-3 text-left active:scale-[0.98] transition-transform duration-100 ${here ? "mt-2 min-h-[64px] bg-accent" : "min-h-[68px] bg-ink text-background"}`}>
            <span>
              <span className={`block font-semibold leading-tight ${here ? "text-[17px]" : "text-lg"}`}>Gasté</span>
              <span className={`block text-sm ${here ? "text-[#3F3B4B]" : "text-background/80"}`}>Efectivo, débito o tarjeta</span>
            </span>
            <span className={`w-[42px] h-[42px] rounded-full flex items-center justify-center shrink-0 ${here ? "bg-ink text-background" : "bg-background text-ink"}`}>
              <ArrowRight className="w-[18px] h-[18px]" />
            </span>
          </button>

          <button onClick={() => go("/income?nuevo=1", "/income")}
            className="mt-2 w-full min-h-[64px] rounded-[22px] bg-accent flex items-center justify-between gap-3 pl-[18px] pr-3 text-left active:scale-[0.98] transition-transform duration-100">
            <span>
              <span className="block font-semibold text-[17px] leading-tight">Me entró plata</span>
              <span className="block text-sm text-[#3F3B4B]">Sueldo u otro ingreso</span>
            </span>
            <span className="w-[42px] h-[42px] rounded-full bg-ink text-background flex items-center justify-center shrink-0">
              <ArrowRight className="w-[18px] h-[18px]" />
            </span>
          </button>

          <div className="mx-1.5 mt-2 divide-y divide-ink/10">
            {SECONDARY.filter(o => o.label !== here?.label).map(({ label, href, form }) => (
              <button key={label} onClick={() => go(href, form)}
                className="w-full min-h-[50px] text-left font-medium text-[15.5px]">
                {label}
              </button>
            ))}
          </div>
          <p className="mx-1.5 mt-2 text-[14.5px] leading-snug text-[#3F3B4B]">
            También podés mandarle al bot un audio, una foto o “verdulería 12 lucas” por WhatsApp.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
