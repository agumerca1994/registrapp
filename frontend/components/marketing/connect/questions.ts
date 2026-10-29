import type { Kind } from "./kind";
import type { ChatMessage } from "./ExampleChat";

/*
 * Las preguntas de ejemplo de /conectar. Cada una se contesta con las tools de
 * backend/app/mcp_server/ (entre corchetes, la que la resuelve), escritas como
 * las diría una persona. Si una tool cambia o desaparece, la pregunta se va.
 */

export interface Verb { verb: "Consultá" | "Analizá" | "Cargá"; text: string; questions: string[] }

export const VERBS: Record<Kind, Verb[]> = {
  household: [
    { verb: "Consultá", text: "Lo que pasa hoy en tu hogar, sin abrir la app.", questions: [
      "¿Cuánto me queda este mes, en pesos y en dólares?",       // get_month_summary
      "¿En qué categoría gasté más este mes?",                   // list_expenses
      "¿Cuánto vence de la Visa el mes que viene?",              // get_upcoming_commitments
    ] },
    { verb: "Analizá", text: "Comparaciones en serio: descontando la inflación.", questions: [
      "¿Gasté más que el mes pasado, descontando la inflación?",  // compare_periods
      "¿Cuánto tengo comprometido en cuotas hasta fin de año?",  // get_upcoming_commitments
      "¿Me alcanza para una tele de $ 900.000 en 6 cuotas?",     // simulate_purchase
    ] },
    { verb: "Cargá", text: "Le pedís que lo anote y te muestra qué va a guardar.", questions: [
      "Anotá 12 lucas de verdulería de ayer.",                   // save_expense
      "Cargá este recibo de sueldo.",                            // save_income_entry
      "Dividí la cena de $ 96.000 con Lucía, mitad cada uno.",   // create_shared_expense
    ] },
  ],
  business: [
    { verb: "Consultá", text: "Cómo viene el negocio, sin abrir la app.", questions: [
      "¿Cuánto vendí ayer y cómo me pagaron?",                   // get_sales method
      "¿Qué productos tengo que reponer?",                       // get_stock only_alerts
      "¿Qué producto facturó más este mes?",                     // get_sales product
    ] },
    { verb: "Analizá", text: "El resultado del mes y la comparación con el anterior.", questions: [
      "¿Cuál fue el resultado del mes: lo que vendí menos lo que gasté?", // get_month_summary
      "¿Vendí más que el mes pasado, descontando la inflación?",  // compare_periods income
      "¿Qué días de la semana vendo más?",                       // get_sales day
    ] },
    { verb: "Cargá", text: "Ventas, producción y el cierre de caja, conversando.", questions: [
      "Vendí 12 empanadas de carne, en efectivo.",               // record_sale
      "Hice 60 empanadas de pollo.",                             // record_stock_movement producción
      "Cerrá el día: 180 mil en efectivo y 95 mil por Mercado Pago.", // record_daily_close
    ] },
  ],
};

export const LONG_PROMPTS: Record<Kind, string[]> = {
  household: [
    // reconcile_statement / get_card_statement
    "Te paso el resumen de la Visa de octubre: fijate qué me falta cargar, qué está de más y qué monto no coincide.",
    // get_budget_baseline (sin cuotas) + armar_presupuesto
    "Armame un presupuesto para el mes que viene con lo que gasto en promedio, sin contar las cuotas que ya tengo.",
    // compare_periods income yoy
    "Mi sueldo de este año, ¿le ganó a la inflación? Comparalo con el del mismo mes del año pasado.",
    // simulate_purchase
    "Quiero comprar un aire acondicionado de $ 1.200.000 en 12 cuotas. ¿Cómo me quedan los próximos meses si lo hago?",
    // get_series deflate=inflation
    "Pasame lo que gasté en los últimos 12 meses en pesos de hoy y decime cuál fue el mes más caro.",
    // get_usd_position
    "¿Cuántos dólares tengo, cuánto valen al blue y cuánto ya gasté con la tarjeta que todavía no se pagó?",
    // list_shared_expenses only=pending_mine + respond_shared_expense
    "¿Tengo algún gasto compartido esperando que lo acepte? Si es el del recital, aceptalo.",
  ],
  business: [
    // get_sales group_by=day
    "Mostrame las ventas de octubre día por día y decime qué días de la semana conviene tener más producción.",
    // save_expense con payee + stock_lines
    "Compré 24 Coca-Cola a Distribuidora Sur por $ 54.000: cargalo como gasto y sumalas al stock.",
    // get_sales group_by=sale (diff por medio de pago)
    "Ayer cerré la caja. ¿Coincide lo que conté con las ventas que cargamos durante el día?",
    // record_stock_movement merma
    "Se nos quemaron 6 empanadas de carne en el horno, descontalas del stock.",
    // analisis_negocio
    "Hacé el análisis del mes del negocio: ventas, gastos, el resultado y en qué me conviene fijarme.",
    // save_product
    "Agregá un producto nuevo: empanada de jamón y queso, a $ 1.500, con stock mínimo de 24.",
  ],
};

/*
 * Los ejemplos del último paso. Los números salen de llamar a las tools reales
 * contra las cuentas de demo locales (Casa Gómez y Rotisería La Esquina) el
 * 2026-10-29: compare_periods + list_expenses + get_upcoming_commitments en el
 * hogar; get_sales (method y product) + get_stock en el negocio.
 */
export const CHATS: Record<Kind, ChatMessage[]> = {
  household: [
    { from: "user", text: "¿Gasté más que el mes pasado?" },
    { from: "assistant", text: "Sí. En octubre van $ 846.300 contra $ 677.200 de septiembre: 25 % más, y 22,6 % más si descontás la inflación del mes (1,9 %). Casi todo es nuevo: la primera cuota de la heladera ($ 95.000) y Restaurantes, que pasó de $ 41.000 a $ 82.000." },
    { from: "user", text: "¿Y cuánto tengo comprometido en cuotas?" },
    { from: "assistant", text: "De noviembre a marzo, $ 157.000 por mes en la Visa: la cuota de la heladera ($ 95.000, sigue hasta septiembre de 2027) y la del colchón ($ 62.000, la última vence en abril)." },
  ],
  business: [
    { from: "user", text: "¿Cuánto vendí ayer y cómo me pagaron?" },
    { from: "assistant", text: "Ayer vendiste $ 269.500: $ 129.000 en efectivo, $ 122.000 por Mercado Pago y $ 18.500 con débito. Lo que más facturó fue la empanada de carne: 96 unidades, $ 144.000." },
    { from: "user", text: "¿Qué tengo que reponer?" },
    { from: "assistant", text: "Tres productos están en el mínimo o debajo: el agua mineral de 500 ml (quedan 9 y el mínimo es 12) y las empanadas de carne y de pollo, con 24 cada una, justo en el mínimo." },
  ],
};
