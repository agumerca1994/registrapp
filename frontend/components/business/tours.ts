import type { Step } from "react-joyride";

/**
 * Las guías del negocio. Cada una explica la pantalla o el formulario donde vive
 * y arranca la primera vez que se abre (ver ProductTour, que pone el globo).
 *
 * Muestran lo que hay en pantalla en el orden en que se mira, y lo mismo en el
 * celular que en la compu: sin `placement`, el globo se ubica solo. Un paso que
 * depende de los datos se agrega sólo si el dato está, porque Joyride se queda
 * esperando un destino que no existe. Por eso esos son funciones.
 *
 * Los tourId son parte de la guía: Configuración los reinicia con
 * BUSINESS_TOUR_IDS y e2e/auth.setup.ts los marca como vistos. Un tourId nuevo
 * va en las dos listas, y cambiarlo le vuelve a mostrar la guía a quien ya la vio.
 * Tarjetas y Calendario tienen sus pasos en su propia pantalla, con su tourId de acá.
 */

const step = (target: string, title: string, content: string): Step => ({
  target: `[data-tour='${target}']`,
  title,
  content,
  skipBeacon: true,
});

export const homeIntroSteps = ({ hasStock }: { hasStock: boolean }): Step[] => [
  step("home-today", "Lo de hoy", "Lo que vendiste en el día. Hasta las 5 de la mañana sigue contando como el día anterior."),
  step("home-close", "El cierre", "Al terminar, contá la caja. El día pasa a sumar lo contado, y ves si faltó o sobró algo."),
  ...(hasStock ? [step("home-stock", "Para resolver", "Lo que quedó en negativo o llegó al mínimo. Una venta nunca se frena por falta de stock: te avisamos acá.")] : []),
  step("home-shortcuts", "A un toque", "Lo que más se usa después de vender, sin pasar por el menú."),
  step("home-result", "El resultado del mes", "Ventas menos egresos, por la fecha en que sale la plata. En Ver detalle está la cuenta."),
  step("home-add", "Nueva venta", "Con el + cargás una venta desde cualquier parte de Inicio."),
];

export const salesIntroSteps = ({ hasTickets }: { hasTickets: boolean }): Step[] => [
  step("sales-day", "El día", "Con las flechas vas a otro día, por si te faltó cargar algo."),
  step("sales-close", "El cierre", "Al terminar, contá la caja. Se precarga con las ventas de cada medio y el día pasa a sumar lo contado."),
  ...(hasTickets ? [step("sales-list", "Las ventas del día", "Tocá una para ver el detalle, corregirla o eliminarla.")] : []),
  step("sales-add", "Nueva venta", "Primero los productos, después cómo se cobró."),
];

export const saleFormSteps = ({ hasProducts }: { hasProducts: boolean }): Step[] => [
  step("sale-total", "Lo que cobraste", hasProducts
    ? "Se llena solo con los productos. Si hiciste un descuento o redondeaste, escribilo: lo cobrado es lo que cuenta."
    : "Poné el total. Cuando cargues productos, los vas a poder vender con un toque."),
  ...(hasProducts ? [step("sale-products", "Los productos", "Tocá lo que vendiste para sumarlo. Si no está en la lista, usá Otra cosa.")] : []),
  step("sale-method", "Cómo se cobró", "Elegí el medio de pago. Si fueron dos, tocá Dividir el pago."),
  step("sale-save", "Cobrar y guardar", "Suma la venta al día. Si no tenés señal y lo tocás de nuevo, no se carga dos veces."),
];

export const closeFormSteps = ({ hasUnits }: { hasUnits: boolean }): Step[] => [
  step("close-counted", "Lo que contaste", "Lo que hay en cada medio de pago. Abajo te dice si hay plata sin ticket o si falta."),
  ...(hasUnits ? [step("close-units", "Las unidades", "Lo que salió en el día, para el stock. Lo que ya restaron las ventas no se resta dos veces.")] : []),
  step("close-save", "Cerrar el día", "El total del día pasa a ser lo contado. Después lo podés editar."),
];

export const productsIntroSteps = ({ canEdit }: { canEdit: boolean }): Step[] => [
  step("products-list", "Lo que hay", "Cuánto queda de lo que lleva stock, y el precio de lista. En rojo, lo que quedó en negativo."),
  step("products-menu", "Mover el stock", "Con los tres puntitos cargás producción, contás lo que queda, anotás merma o ves los movimientos."),
  step("products-produce", "Cargar producción", "Suma lo que salió de la cocina, sin buscar el producto en la lista."),
  ...(canEdit ? [step("products-add", "Nuevo producto", "Lo que cargues acá se vende con un toque desde Ventas.")] : []),
];

export const PRODUCT_FORM_STEPS: Step[] = [
  step("product-kind", "Elaborado o reventa", "Elaborado es lo que hacés vos. Reventa, lo que comprás hecho y vendés igual."),
  step("product-price", "El precio", "El de lista: lo que propone una venta. Después podés cobrar otra cosa."),
  step("product-name", "El nombre", "No se puede repetir. Es lo que vas a tocar para vender."),
  step("product-save", "Guardar", "Queda listo para venderlo desde Ventas."),
];

export const PAYEES_INTRO_STEPS: Step[] = [
  step("payees-filter", "Todos en una lista", "Filtrá por proveedores o por empleados."),
  step("payees-list", "Cuánto se le pagó", "Tocá el nombre para editarlo, y el monto del mes para ver sus gastos."),
  step("payees-add", "Sumar a alguien", "Después lo elegís al cargar un gasto, y su categoría habitual se completa sola."),
];

export const EXPENSE_BUSINESS_STEPS: Step[] = [
  step("expense-payee", "A quién le pagaste", "Si tiene categoría habitual, se completa sola."),
  step("expense-stock", "¿Entra al stock?", "Si compraste mercadería para vender (como 12 Coca-Cola), elegí Sí y cargá productos y cantidades. La materia prima no va acá."),
  step("expense-save", "Guardar", "Queda en Egresos, y si entra al stock, también en tus productos."),
];

export const EXPENSES_BUSINESS_INTRO_STEPS: Step[] = [
  step("expenses-filter", "Encontrar un gasto", "Buscá por descripción o categoría. Con Personalizado filtrás por fecha, categoría o medio de pago."),
  step("expenses-add", "Nuevo egreso", "Monto, categoría y, si corresponde, proveedor o empleado. Si es mercadería para vender, también entra al stock."),
];

export const BUSINESS_TOUR_IDS = [
  "sales-intro", "sale-form", "close-form",
  "products-intro", "product-form",
  "payees-intro",
  "expense-business",
  "home-intro", "cards-intro", "calendar-intro", "expenses-business-intro",
];
