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
    version: "1.1.0-beta.1",
    date: "2026-11-05",
    notes: [
      "tood tiene un diseño nuevo en todas las pantallas.",
      "Inicio te cuenta cómo viene el día, además del mes.",
      "Ingresos y egresos ahora están juntos en Movimientos.",
      "Las guías muestran lo que hay en cada pantalla, también en el celular.",
      "Cerrar sesión pasó a Configuración, en Tu cuenta.",
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
