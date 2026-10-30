import { LOGO_CLIP, LOGO_PATHS, LOGO_VIEWBOX } from "@/lib/brand/tero-marca";

// Logo "tero" con el copete en la t. Toma el color del texto (currentColor), así que se pinta con
// clases de color: <TeroLogo className="h-8 w-auto text-primary" />. El alto lo da la clase; el ancho sale solo.
// Sin hooks a propósito, para poder usarlo en componentes de servidor. El recorte del palito lleva un id fijo:
// si hay dos logos en la misma página comparten la misma definición, que es idéntica, y funciona igual.
export function TeroLogo({ className, title = "tero", clipId = "tero-logo-clip" }: { className?: string; title?: string; clipId?: string }) {
  return (
    <svg viewBox={LOGO_VIEWBOX} className={className} role="img" aria-label={title} fill="currentColor">
      <defs dangerouslySetInnerHTML={{ __html: LOGO_CLIP.replace("TERO_CLIP", clipId) }} />
      <g transform="scale(1 -1)" dangerouslySetInnerHTML={{ __html: LOGO_PATHS.replaceAll("TERO_CLIP", clipId) }} />
    </svg>
  );
}
