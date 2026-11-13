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
    version: "1.2.1",
    date: "2026-11-13",
    notes: [
      "El bot de WhatsApp baja tus fotos, PDFs y audios por un camino más corto y más estable.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-11-13",
    notes: [
      "Gastos recurrentes: marcá una suscripción, el alquiler o el gimnasio con \"Se repite todos los meses\" y el mes siguiente aparece solo, para que lo confirmes o le cambies el monto.",
      "Un recurrente a confirmar ya suma en el mes. Lo ves en el calendario, y si se pasó la fecha, Inicio te lo pide.",
      "Si un mes no vino, elegís si sigue el mes que viene o lo das de baja.",
      "Al subir el resumen de la tarjeta, los recurrentes que vinieron se confirman con el monto del banco.",
      "Lo que tenías marcado como Recurrente en tus tarjetas de octubre o noviembre ya tiene el mes siguiente a confirmar.",
      "Los recurrentes en dólares también se pueden cargar en la tarjeta.",
    ],
  },
  {
    version: "1.1.1",
    date: "2026-11-13",
    notes: [
      "Una compra con tarjeta que mandás por WhatsApp va al resumen del mes, aunque un resumen futuro ya tenga fecha de cierre.",
    ],
  },
  {
    // Las 15 tandas de la beta se resumen acá: quien viene de producción ve qué cambió, no cada prueba.
    version: "1.1.0",
    date: "2026-11-11",
    notes: [
      "tood tiene un diseño nuevo en todas las pantallas.",
      "Inicio te cuenta cuánto te queda para gastar hasta fin de mes y cómo viene el día.",
      "Ingresos y egresos ahora están juntos en Movimientos.",
      "Hipoteca pasó a ser Créditos: además del hipotecario, préstamos personales, prendarios, planes de ahorro y plata que te prestó alguien.",
      "Objetivos: ponele monto y fecha a algo que quieras, y te dice cuánto apartar por mes. Con una cuota fija, Inicio te avisa el día que toca.",
      "Inversiones: plazos fijos, cuentas remuneradas, fondos, acciones, cripto o efectivo, con cuánto valen hoy y cuánto ganaste.",
      "El + del centro ofrece primero lo que se agrega en la pantalla donde estás.",
      "Las guías esperan a que cierres un formulario y aparecen una sola vez.",
      "Cerrar sesión y la versión de la app están en Configuración.",
    ],
  },
  {
    version: "1.0.7",
    date: "2026-11-06",
    notes: [
      "Preparamos los objetivos con una cuota fija por mes, que llega pronto.",
    ],
  },
  {
    version: "1.0.6",
    date: "2026-11-06",
    notes: [
      "Preparamos Inversiones para fondos que rinden: se va a poder rescatar más de lo que pusiste.",
    ],
  },
  {
    version: "1.0.5",
    date: "2026-11-06",
    notes: [
      "Preparamos la app para Inversiones, que llega pronto.",
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
