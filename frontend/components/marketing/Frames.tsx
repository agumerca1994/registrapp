import Image from "next/image";

/**
 * Las capturas de las páginas públicas (/, /hogar, /negocio): una pantalla de
 * la app dentro de un marco de navegador o de celular. Son capturas reales de
 * cuentas de demo (ver tools/instructivo/).
 */

export function Screen({ src, alt, hero = false, height = 800 }: {
  src: string; alt: string; hero?: boolean; height?: number;
}) {
  return (
    <div className={`rounded-2xl border-2 border-ink bg-card overflow-hidden ${hero ? "shadow-hero" : "shadow-chip"}`}>
      <div className="flex gap-1.5 px-3 py-2 border-b-2 border-ink bg-accent" aria-hidden="true">
        <span className="w-2.5 h-2.5 rounded-full bg-white border border-ink/30" />
        <span className="w-2.5 h-2.5 rounded-full bg-white border border-ink/30" />
        <span className="w-2.5 h-2.5 rounded-full bg-white border border-ink/30" />
      </div>
      <Image src={src} alt={alt} width={1280} height={height} className="w-full h-auto" priority={hero} />
    </div>
  );
}

/**
 * Una captura de 390×844 (a 2×) dentro de un celular. El marco es fino y la
 * pantalla tiene poco redondeo: con un marco grueso y esquinas grandes, la
 * curva se comía el contenido de las esquinas (el logo, los montos).
 */
export function Phone({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`rounded-[1.4rem] border-2 border-ink bg-ink p-[3px] shadow-chip ${className}`}>
      <div className="rounded-[1.15rem] overflow-hidden bg-card">
        <Image src={src} alt={alt} width={780} height={1688} className="w-full h-auto" />
      </div>
    </div>
  );
}
