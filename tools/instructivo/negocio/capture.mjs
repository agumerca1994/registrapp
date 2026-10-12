// Instructivo de RegistrApp Negocio: crea una cuenta de demo en la app LOCAL,
// carga datos de ejemplo por la API y captura pantallas y flujos.
// Requiere `docker compose up` y `npm run emulator` (frontend/). Uso:
//   node tools/instructivo/negocio/capture.mjs
//   python3 ~/.claude/agents/instructivo-kit/build_deck.py tools/instructivo/negocio/deck.json
// Ver .claude/instructivo/registrapp.md y el agente instructivo-builder.
import { chromium } from "../../../frontend/node_modules/playwright/index.mjs";
import fs from "node:fs";

// Las salidas van FUERA del repo: una captura suelta dentro del árbol frena el deploy.
const WORK = "/private/tmp/registrapp-instructivo/negocio";
fs.mkdirSync(WORK, { recursive: true });
const OUT = `${WORK}/frames.json`;
const APP = "http://localhost:3000";
const API = "http://localhost:8000";
const EMAIL = `laura${Date.now() % 100000}@demo.local`;
const PASSWORD = "demo-password-123";
const VIEW = { width: 1280, height: 800 };
const TOURS = ["dashboard-intro", "income-intro", "expenses-intro", "sales-intro", "sale-form", "close-form",
  "products-intro", "product-form", "payees-intro", "expense-business", "home-intro", "cards-intro",
  "calendar-intro", "expenses-business-intro"];

const wait = (ms) => new Promise(r => setTimeout(r, ms));
// El día de negocio: Argentina, con corte a las 05:00 (igual que la app).
const arNow = new Date(Date.now() - 5 * 3600e3).toLocaleString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" });
const TODAY = arNow.slice(0, 10);
const [Y, M, D] = TODAY.split("-").map(Number);
const day = (d) => `${Y}-${String(M).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const out = { view: VIEW, stills: {}, flows: {} };

async function jpeg(page) {
  return (await page.screenshot({ type: "jpeg", quality: 72 })).toString("base64");
}

async function still(page, name) {
  await wait(700);
  out.stills[name] = await jpeg(page);
  console.log("still", name);
}

// Un paso de un flujo: la pantalla tal como está, y dónde se va a tocar.
async function step(page, flow, caption, target) {
  await wait(600);
  let tap = null;
  if (target) {
    await target.scrollIntoViewIfNeeded().catch(() => {});
    const box = await target.boundingBox();
    if (box) tap = { x: (box.x + box.width / 2) / VIEW.width, y: (box.y + box.height / 2) / VIEW.height };
  }
  (out.flows[flow] ??= []).push({ img: await jpeg(page), caption, tap });
  console.log("step", flow, "-", caption);
}

const browser = await chromium.launch();

// ── Cuenta y datos ────────────────────────────────────────────────────────────
const ctx = await browser.newContext({ viewport: VIEW, reducedMotion: "reduce" });
await ctx.addInitScript((ids) => { for (const id of ids) localStorage.setItem(`tour_seen_${id}`, "1"); }, TOURS);
const page = await ctx.newPage();
await page.goto(APP + "/login");
const token = await page.evaluate(async ({ email, password }) => {
  const w = window;
  await w.__e2e.ready;
  const cred = await w.__e2e.createUserWithEmailAndPassword(w.__e2e.auth, email, password);
  return cred.user.getIdToken();
}, { email: EMAIL, password: PASSWORD });
const H = { Authorization: `Bearer ${token}` };

async function api(method, path, data) {
  const res = await page.request.fetch(API + path, { method, headers: H, data });
  if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${await res.text()}`);
  return res.status() === 204 ? null : res.json();
}

await api("POST", "/auth/register", {
  tenant_name: "Rotisería La Esquina", kind: "business",
  first_name: "Laura", last_name: "Gómez", alias: `laura.esquina${Date.now() % 10000}`,
});
await api("POST", "/auth/me/skip-whatsapp-gate");

let cats = await api("GET", "/expenses/categories");
async function cat(name) {
  let c = cats.find(x => x.name === name);
  if (!c) { c = await api("POST", "/expenses/categories", { name, color: "#6366f1", is_fixed: false }); cats.push(c); }
  return c.id;
}

const P = {};
const PRICE = {};
for (const p of [
  { name: "Empanada de carne", kind: "elaborado", unit: "unidad", sale_price: 1500, track_stock: true, min_stock: 24 },
  { name: "Empanada de pollo", kind: "elaborado", unit: "unidad", sale_price: 1500, track_stock: true, min_stock: 24 },
  { name: "Pollo al spiedo", kind: "elaborado", unit: "unidad", sale_price: 14000, track_stock: false },
  { name: "Tarta de verdura", kind: "elaborado", unit: "porcion", sale_price: 3500, track_stock: false },
  { name: "Coca-Cola 500 ml", kind: "reventa", unit: "unidad", sale_price: 2500, min_stock: 12 },
  { name: "Agua mineral 500 ml", kind: "reventa", unit: "unidad", sale_price: 1500, min_stock: 12 },
]) { P[p.name] = (await api("POST", "/products", p)).id; PRICE[p.name] = p.sale_price; }

const PAY = {};
for (const p of [
  { name: "Distribuidora Sur", kind: "proveedor", default_category_id: await cat("Mercadería") },
  { name: "Verdulería Don José", kind: "proveedor", default_category_id: await cat("Materia prima") },
  { name: "Juan Pérez", kind: "empleado", default_category_id: await cat("Sueldos") },
  { name: "Inmobiliaria Centro", kind: "proveedor", default_category_id: await cat("Alquiler") },
]) PAY[p.name] = (await api("POST", "/payees", p)).id;

const exp = (d, amount, category, description, payee, stock_lines) => api("POST", "/expenses/entries", {
  expense_date: day(d), amount, category_id: category, description, payee_id: payee ?? null,
  ...(stock_lines ? { stock_lines } : {}),
});
await exp(1, 450000, await cat("Alquiler"), "Alquiler del local", PAY["Inmobiliaria Centro"]);
await exp(2, 54000, await cat("Mercadería"), "24 Coca-Cola 500 ml", PAY["Distribuidora Sur"],
  [{ product_id: P["Coca-Cola 500 ml"], qty: 24 }]);
await exp(3, 42000, await cat("Materia prima"), "Verdura de la semana", PAY["Verdulería Don José"]);
await exp(5, 380000, await cat("Sueldos"), "Sueldo quincena", PAY["Juan Pérez"]);
await exp(8, 68000, await cat("Servicios"), "Luz");
await exp(9, 15600, await cat("Mercadería"), "12 Agua mineral", PAY["Distribuidora Sur"],
  [{ product_id: P["Agua mineral 500 ml"], qty: 12 }]);

for (const [name, qty, d] of [["Empanada de carne", 60, D - 1], ["Empanada de pollo", 48, D - 1], ["Empanada de carne", 40, D]]) {
  await api("POST", "/stock/movements", { product_id: P[name], kind: "produccion", qty, movement_date: day(d) });
}

// Los días anteriores del mes, cerrados.
const closes = [[1, 182000, 95000, 24000], [2, 205000, 110000, 31000], [3, 168000, 87000, 18000],
  [4, 240000, 132000, 40000], [5, 260000, 145000, 52000], [7, 176000, 99000, 21000],
  [8, 198000, 104000, 27000], [9, 222000, 126000, 35000], [10, 251000, 140000, 46000]];
for (const [d, ef, mp, deb] of closes.filter(c => c[0] < D)) {
  await api("PUT", `/sales/close/${day(d)}`, { counted: [
    { method: "efectivo", amount: ef }, { method: "mercadopago", amount: mp }, { method: "debito", amount: deb },
  ] });
}

// Las ventas de hoy, una por una.
const sale = (lines, payments) => api("POST", "/sales", {
  sale_date: TODAY, lines: lines.map(([n, qty]) => ({ product_id: P[n], qty, unit_price: PRICE[n] })), payments,
});
await sale([["Empanada de carne", 6], ["Coca-Cola 500 ml", 2]], [{ method: "efectivo", amount: 14000 }]);
await sale([["Pollo al spiedo", 1]], [{ method: "mercadopago", amount: 14000 }]);
await sale([["Empanada de pollo", 12]], [{ method: "efectivo", amount: 10000 }, { method: "mercadopago", amount: 8000 }]);
await sale([["Tarta de verdura", 2], ["Agua mineral 500 ml", 2]], [{ method: "debito", amount: 10000 }]);

const card = await api("POST", "/credit-cards", { bank: "BBVA", alias: "Visa negocio", titular: "Laura Gómez", last_4_digits: "4821", due_day: 10 });
await api("POST", `/credit-cards/${card.id}/items`, {
  description: "Freidora industrial", category_id: await cat("Mantenimiento"), item_date: day(4),
  item_type: "installment", amount: 45000, installment_count: 6, year: Y, month: M,
});
await api("POST", "/reminders", { title: "Pagar monotributo", remind_date: day(Math.min(D + 9, 28)) });
console.log("datos cargados para", EMAIL);
await ctx.storageState({ path: `${WORK}/state.json` });

// ── Pantallas ─────────────────────────────────────────────────────────────────
await page.goto(APP + "/dashboard");
await page.getByText("Ventas por medio de pago").first().waitFor({ timeout: 15000 });
await still(page, "inicio");
await page.getByRole("button", { name: /Ver detalle/ }).first().click().catch(() => {});
await still(page, "inicio-detalle");

for (const [path, name, ready] of [
  ["/ventas", "ventas", "Ventas de hoy"],
  ["/productos", "productos", "Empanada de carne"],
  ["/proveedores", "proveedores", "Distribuidora Sur"],
  ["/expenses", "egresos", "Alquiler del local"],
  ["/tarjetas", "tarjetas", "Visa negocio"],
  ["/calendario", "calendario", "Calendario de pagos"],
  ["/settings", "configuracion", "Configuración"],
]) {
  await page.goto(APP + path);
  await page.getByText(ready).first().waitFor({ timeout: 15000 });
  await still(page, name);
}

// El menú de un producto.
await page.goto(APP + "/productos");
await page.getByRole("button", { name: "Acciones de Empanada de carne" }).click();
await still(page, "producto-menu");
await page.keyboard.press("Escape");

fs.writeFileSync(OUT, JSON.stringify(out));
console.log("parcial guardado");

// ── Flujos ────────────────────────────────────────────────────────────────────
// Cargar un producto.
await page.goto(APP + "/productos");
await page.getByText("Empanada de carne").first().waitFor();
let t = page.getByRole("button", { name: "Nuevo producto" });
await step(page, "producto", "En Productos, tocá + para crear uno.", t);
await t.click();
t = page.getByPlaceholder("Empanada de carne");
await step(page, "producto", "Elegí si lo hacés vos (elaborado) o lo comprás para vender (reventa), y escribí el nombre.", t);
await t.fill("Flan casero");
t = page.getByLabel("Precio");
await step(page, "producto", "Poné el precio de venta.", t);
await t.fill("3.000");
t = page.getByRole("button", { name: "Crear" });
await step(page, "producto", "Tocá Crear.", t);
await t.click();
await page.getByText("Flan casero").first().waitFor();
await step(page, "producto", "Listo: el producto ya aparece en la lista y en Nueva venta.", null);

// Cargar una venta.
await page.goto(APP + "/ventas");
await page.getByText("Ventas de hoy").first().waitFor();
t = page.getByRole("button", { name: "Nueva venta" });
await step(page, "venta", "En Ventas, tocá + Nueva venta.", t);
await t.click();
t = page.locator("[data-tour='sale-products']").getByRole("button", { name: /Empanada de carne/ });
await step(page, "venta", "Tocá los productos que vendiste: cada toque suma uno.", t);
await t.click(); await wait(150); await t.click(); await wait(150); await t.click();
t = page.locator("[data-tour='sale-products']").getByRole("button", { name: /Coca-Cola/ });
await step(page, "venta", "Van 3 empanadas. Sumá la gaseosa.", t);
await t.click();
t = page.getByRole("radio", { name: "Mercado Pago" }).first();
await step(page, "venta", "El total se calcula con los precios. Elegí cómo te pagaron.", t);
await t.click();
t = page.getByRole("button", { name: /Cobrar/ });
await step(page, "venta", "Tocá Cobrar.", t);
await t.click();
await wait(1200);
await step(page, "venta", "La venta queda en la lista del día y suma al total.", null);

// Una compra que entra al stock.
await page.goto(APP + "/expenses?nuevo=1");
t = page.getByLabel("Monto", { exact: true });
await t.waitFor();
await step(page, "compra", "En Egresos, tocá + y escribí el monto.", t);
await t.fill("27.000");
t = page.locator("[data-tour='expense-payee'] [role='combobox']");
await step(page, "compra", "Elegí a quién le compraste.", t);
await t.click();
t = page.getByRole("option", { name: "Distribuidora Sur" });
await step(page, "compra", "La categoría habitual del proveedor se completa sola.", t);
await t.click();
t = page.getByRole("group", { name: "¿Entra al stock?" }).getByRole("button", { name: "Sí" });
await step(page, "compra", "Si es mercadería para vender, activá ¿Entra al stock?", t);
await t.click();
t = page.locator("[data-testid='stock-line'] [role='combobox']").first();
await step(page, "compra", "Elegí el producto…", t);
await t.click();
t = page.getByRole("option", { name: "Coca-Cola 500 ml" });
await step(page, "compra", "…en este caso, la gaseosa.", t);
await t.click();
t = page.getByLabel("Cantidad que entra");
await step(page, "compra", "Y cuántas unidades entraron.", t);
await t.fill("12");
t = page.getByRole("button", { name: "Guardar" });
await step(page, "compra", "Tocá Guardar.", t);
await t.click();
await wait(1500);
await step(page, "compra", "El gasto queda en Egresos y las 12 gaseosas suman al stock.", null);

// Cargar la producción.
await page.goto(APP + "/productos");
await page.getByText("Empanada de carne").first().waitFor();
t = page.getByRole("button", { name: "Cargar producción" });
await step(page, "produccion", "En Productos, tocá Cargar producción.", t);
await t.click();
t = page.locator("form [role='combobox']").first();
await step(page, "produccion", "Elegí el producto.", t);
await t.click();
t = page.getByRole("option", { name: "Empanada de pollo" });
await step(page, "produccion", "Por ejemplo, las empanadas de pollo.", t);
await t.click();
t = page.locator("form input[inputmode='decimal']").first();
await step(page, "produccion", "Escribí cuántas hiciste.", t);
await t.fill("36");
t = page.getByRole("button", { name: "Guardar" });
await step(page, "produccion", "Tocá Guardar.", t);
await t.click();
await wait(1500);
await step(page, "produccion", "El stock se actualiza al instante.", null);

// Cerrar el día.
await page.goto(APP + "/ventas");
await page.getByText("Ventas de hoy").first().waitFor();
t = page.getByRole("button", { name: "Cerrar el día" }).first();
await step(page, "cierre", "Al final del día, tocá Cerrar el día.", t);
await t.click();
t = page.getByLabel("Contado en Efectivo");
await step(page, "cierre", "Ya viene con lo vendido por cada medio. Corregí con lo que contaste en la caja.", t);
await t.fill("26.000");
t = page.locator("form").getByRole("button", { name: "Cerrar el día" });
await step(page, "cierre", "Tocá Cerrar el día.", t);
await t.click();
await wait(1500);
await step(page, "cierre", "El día queda cerrado y suma lo contado. Si falta plata, te lo marca.", null);

fs.writeFileSync(OUT, JSON.stringify(out));
console.log("listo:", Object.keys(out.stills).length, "pantallas,", Object.keys(out.flows).length, "flujos");
await browser.close();
