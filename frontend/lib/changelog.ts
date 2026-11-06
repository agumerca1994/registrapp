/**
 * Lo que cambió en cada versión, de la más nueva a la más vieja. Lo lee la gente en
 * Configuración: se escribe por lo que notan, sin jerga. `scripts/release.sh` no
 * saca una versión sin su entrada.
 */
export interface Release {
  version: string;
  date: string;
  notes: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: "1.0.3",
    date: "2026-11-05",
    notes: [
      "La hipoteca deja de registrar cuotas cuando llega a la última.",
      "La cuota se registra con la fecha de la Argentina, no con la del servidor.",
    ],
  },
  {
    version: "1.0.2",
    date: "2026-11-05",
    notes: [
      "Si WhatsApp tarda en entregar una foto, un PDF o un audio, el bot vuelve a intentar antes de pedirte que lo mandes de nuevo.",
    ],
  },
  {
    version: "1.0.1",
    date: "2026-11-05",
    notes: [
      "En el bot podés corregir como hablás: \"me equivoqué, eran 35.000\" o \"fue descartables\".",
      "El bot entiende categoría y descripción en un mismo mensaje.",
      "Un reintegro se carga como ingreso, aunque no digas \"cobré\".",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-11-05",
    notes: [
      "Empezamos a numerar las versiones de tood.",
      "Podés cargar gastos e ingresos por audio en el bot de WhatsApp.",
      "Cada fila dice quién la cargó, si en tu hogar son varias personas.",
    ],
  },
];
