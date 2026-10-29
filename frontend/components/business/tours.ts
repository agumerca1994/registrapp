import type { Step } from "react-joyride";

/**
 * Los recorridos guiados del negocio. Cada uno explica la pantalla o el
 * formulario donde vive y arranca la primera vez que se abre (ver ProductTour).
 *
 * Los tourId son parte de la guía: Configuración los reinicia con
 * BUSINESS_TOUR_IDS y e2e/auth.setup.ts los marca como vistos. Un tourId nuevo
 * va en las dos listas.
 */

const step = (target: string, content: string): Step => ({
  target: `[data-tour='${target}']`,
  content,
  placement: "auto",
  skipBeacon: true,
});

export const SALES_INTRO_STEPS: Step[] = [
  step("sales-add", "Tocá Nueva venta para cargar una venta: primero los productos, después cómo se cobró."),
  step("sales-close", "Al final del día tocá Cerrar el día y contá la caja. Con el cierre, el día suma lo que realmente entró."),
];

export const SALE_FORM_STEPS: Step[] = [
  step("sale-products", "Tocá los productos que vendiste para sumarlos. Con + y − cambiás la cantidad. Si es algo que no está en la lista, usá Otra cosa."),
  step("sale-total", "Escribí lo que te pagaron. Si lo dejás vacío, se toma el precio de lista de los productos."),
  step("sale-method", "Elegí cómo se cobró. Si fueron dos medios, tocá Dividir el pago."),
  step("sale-save", "Tocá Cobrar para guardar la venta. Aparece en la lista del día."),
];

export const CLOSE_FORM_STEPS: Step[] = [
  step("close-counted", "Escribí cuánto contaste en cada medio de pago. Un medio sin plata va en cero."),
  step("close-save", "Tocá Cerrar el día. El total del día pasa a ser lo contado."),
];

export const PRODUCTS_INTRO_STEPS: Step[] = [
  step("products-produce", "Cargar producción suma lo que hiciste. Con los tres puntitos de cada producto contás lo que queda, anotás merma o ves sus movimientos."),
  step("products-add", "Tocá + para crear un producto. Elegí si lo hacés vos (elaborado) o lo comprás para vender (reventa)."),
];

export const PRODUCT_FORM_STEPS: Step[] = [
  step("product-name", "El nombre no se puede repetir. Por ejemplo: Empanada de carne."),
  step("product-price", "El precio de venta. Se usa cuando la venta no tiene total cobrado."),
  step("product-save", "Tocá Crear para guardar el producto."),
];

export const PAYEES_INTRO_STEPS: Step[] = [
  step("payees-add", "Tocá + para cargar un proveedor o un empleado. Así cada pago queda asociado a quien lo recibió."),
];

export const EXPENSE_BUSINESS_STEPS: Step[] = [
  step("expense-payee", "Elegí a quién le pagaste. Si tiene categoría habitual, se completa sola."),
  step("expense-stock", "Si compraste mercadería para vender (como 12 Coca-Cola), activá Sí y cargá productos y cantidades. La materia prima no va acá."),
  step("expense-save", "Tocá Guardar egreso para registrarlo."),
];

export const HOME_INTRO_STEPS: Step[] = [
  step("home-month", "Elegí el mes con las flechas. Todo lo de esta pantalla es de ese mes."),
  step("home-result", "Es el resultado del mes: ventas menos egresos, contados por la fecha en que sale la plata. Tocá Ver detalle para ver de dónde sale cada número."),
  step("home-stock", "Stock para revisar: productos en negativo (falta cargar producción o un ingreso) o en el mínimo."),
  step("home-breakdowns", "Cuatro resúmenes del mes: ventas por medio de pago, lo más vendido, egresos por categoría y pagos a proveedores y empleados."),
  step("home-add", "El + abre una venta nueva."),
];

export const CARDS_INTRO_STEPS: Step[] = [
  step("cards-new", "Con este botón creás una tarjeta: banco, alias y los últimos 4 números."),
  step("cards-upload", "Subí el PDF del resumen y RegistrApp carga los consumos y los compara con lo que ya tenías."),
];

export const CALENDAR_INTRO_STEPS: Step[] = [
  step("cal-grid", "Cada día tiene puntitos: naranja para el cierre de un resumen, rojo para el vencimiento y violeta para tus recordatorios."),
  step("cal-day", "Abajo está el detalle del día que elegiste. Tocá otro día para verlo."),
  step("cal-add", "Agregá un recordatorio para cualquier día, por ejemplo cuando tenés que pagar algo."),
];

export const EXPENSES_BUSINESS_INTRO_STEPS: Step[] = [
  step("expenses-filter", "Buscá por descripción o categoría. Con Personalizado filtrás por fecha, categoría o medio de pago."),
  step("expenses-add", "Con este + registrás un egreso: monto, categoría y, si corresponde, proveedor o empleado. Si es mercadería para vender, activá ¿Entra al stock?."),
];

export const BUSINESS_TOUR_IDS = [
  "sales-intro", "sale-form", "close-form",
  "products-intro", "product-form",
  "payees-intro",
  "expense-business",
  "home-intro", "cards-intro", "calendar-intro", "expenses-business-intro",
];
