import { CopyButton } from "@/components/ui/copy-button";

/**
 * Lo que hay que pegar en el asistente, con su botón Copiar. El botón es el de
 * Configuración (`CopyButton`), así copiar se ve igual en la app y acá.
 * Copia `value`, nunca la selección: un comando largo se parte en líneas en un
 * celular y esos cortes no tienen que viajar al portapapeles.
 */
export function CopyUrl({ value, label, display }: { value: string; label: string; display?: React.ReactNode }) {
  return (
    <div className="rounded-xl border-2 border-ink bg-card p-2 pl-3 flex flex-wrap sm:flex-nowrap items-center gap-2 shadow-chip">
      <code aria-label={label} className="basis-full sm:basis-auto flex-1 min-w-0 font-mono text-sm text-foreground break-all py-1">
        {display ?? value}
      </code>
      <CopyButton value={value} className="shrink-0 ml-auto" />
    </div>
  );
}
