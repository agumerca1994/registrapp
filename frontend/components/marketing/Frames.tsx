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
 * Una captura de 390×844 (a 2×) dentro de la silueta de un celular: plana, sin
 * la sombra desplazada de la app, que acá lo hacía ver como un botón más.
 *
 * Las esquinas redondeadas caen sobre una barra de estado y una franja inferior
 * que no son de la captura: así la curva no se come el logo ni la barra de
 * pestañas, que era lo que pasaba al recortar la captura directamente.
 * Todas las medidas van en `cqw` (ancho del celular), así se ve igual a 150 px
 * en la portada que a 260 px sola. `className` va en el envoltorio: ancho y
 * posición los decide quien lo usa.
 */
export function Phone({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`[container-type:inline-size] ${className}`}>
      <div className="relative rounded-[14cqw] bg-ink p-[3cqw]">
        {/* Botones laterales: volumen a la izquierda, encendido a la derecha. */}
        <span aria-hidden="true" className="absolute -left-[1cqw] top-[18%] h-[7%] w-[1.2cqw] rounded-l bg-ink" />
        <span aria-hidden="true" className="absolute -left-[1cqw] top-[27%] h-[7%] w-[1.2cqw] rounded-l bg-ink" />
        <span aria-hidden="true" className="absolute -right-[1cqw] top-[22%] h-[11%] w-[1.2cqw] rounded-r bg-ink" />
        <div className="overflow-hidden rounded-[11cqw] bg-card">
          <div aria-hidden="true" className="relative flex h-[11cqw] items-center justify-between px-[8cqw] text-[3.4cqw] font-semibold text-foreground">
            <span>9:41</span>
            <span className="absolute left-1/2 top-[2cqw] h-[7.5cqw] w-[27cqw] -translate-x-1/2 rounded-full bg-ink" />
            <span className="flex items-center gap-[0.6cqw]">
              <span className="h-[2.6cqw] w-[5.2cqw] rounded-[0.8cqw] border-[0.4cqw] border-foreground p-[0.4cqw]">
                <span className="block h-full w-3/4 rounded-[0.3cqw] bg-foreground" />
              </span>
            </span>
          </div>
          <Image src={src} alt={alt} width={780} height={1688} className="block w-full h-auto" />
          <div aria-hidden="true" className="flex h-[6cqw] items-center justify-center bg-background">
            <span className="h-[1.3cqw] w-[34cqw] rounded-full bg-ink/80" />
          </div>
        </div>
      </div>
    </div>
  );
}
