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
    version: "1.1.0-beta.3",
    date: "2026-11-06",
    notes: [
      "En Créditos, el botón para agregar uno está arriba, como en Ahorro.",
    ],
  },
  {
    version: "1.1.0-beta.2",
    date: "2026-11-06",
    notes: [
      "Hipoteca pasó a ser Créditos: además del hipotecario, préstamos personales, prendarios, planes de ahorro y plata que te prestó alguien.",
      "Si sabés cuánto pagás por mes, alcanza con la cuota y la cantidad de cuotas.",
      "Ahorro: armá objetivos con fecha y la app te dice cuánto apartar por mes para llegar.",
    ],
  },
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
    version: "1.0.4",
    date: "2026-11-06",
    notes: [
      "Preparamos la app para Créditos y Ahorro, que llegan pronto.",
    ],
  },
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
