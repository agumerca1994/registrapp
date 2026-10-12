// Instructivo de RegistrApp Hogar: crea una cuenta de demo en la app LOCAL,
// carga datos de ejemplo por la API y captura pantallas y flujos.
// Requiere `docker compose up` y `npm run emulator` (frontend/). Uso:
//   node tools/instructivo/hogar/capture.mjs
//   python3 ~/.claude/agents/instructivo-kit/build_deck.py tools/instructivo/hogar/deck.json
// Ver .claude/instructivo/registrapp.md y el agente instructivo-builder.
//
// El hogar de ejemplo es "Casa Gómez": Martín (dueño de la cuenta) y Ana, que se
// suma con el código. Lucía Fernández es una amiga con su propio hogar, para los
// gastos compartidos. Tres cuentas nuevas en cada corrida, nunca las de los E2E.
import { chromium } from "../../../frontend/node_modules/playwright/index.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { recorder } = await import(path.join(os.homedir(), ".claude/agents/instructivo-kit/capture-lib.mjs"));

// Las salidas van FUERA del repo: una captura suelta dentro del árbol frena el deploy.
const WORK = "/private/tmp/registrapp-instructivo/hogar";
fs.mkdirSync(WORK, { recursive: true });
const APP = "http://localhost:3000";
const API = "http://localhost:8000";
const N = Date.now() % 1000;
const PASSWORD = "demo-password-123";
const VIEW = { width: 1280, height: 800 };

// Lo que tapa pantallas se lee del código, así una guía o un carrusel nuevo no
// aparece en las capturas porque alguien se olvidó de sumarlo acá.
const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../frontend");
function grepSources(dir, re, acc = new Set()) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (!["node_modules", ".next", "e2e"].includes(f.name)) grepSources(p, re, acc); }
    else if (/\.tsx?$/.test(f.name)) for (const m of fs.readFileSync(p, "utf8").matchAll(re)) acc.add(m[1]);
  }
  return acc;
}
const TOURS = [...grepSources(path.join(FRONT, "app"), /tourId="([^"]+)"/g),
  ...grepSources(path.join(FRONT, "components"), /tourId="([^"]+)"/g)];
const businessTours = fs.readFileSync(path.join(FRONT, "components/business/tours.ts"), "utf8")
  .match(/BUSINESS_TOUR_IDS = \[([\s\S]*?)\]/)[1].match(/"([^"]+)"/g).map(s => s.slice(1, -1));
const SEEN_KEYS = [...new Set([...TOURS, ...businessTours])].map(id => `tour_seen_${id}`);
SEEN_KEYS.push(fs.readFileSync(path.join(FRONT, "components/WhatsNewCarousel.tsx"), "utf8")
  .match(/WHATS_NEW_KEY = "([^"]+)"/)[1]);

const wait = (ms) => new Promise(r => setTimeout(r, ms));
// "Hoy" en la Argentina, igual que services/clock.ar_today().
const TODAY = new Date().toLocaleString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" }).slice(0, 10);
const [Y, M, D] = TODAY.split("-").map(Number);
const pad = (n) => String(n).padStart(2, "0");
const day = (d, m = M, y = Y) => `${y}-${pad(m)}-${pad(d)}`;
const PM = M === 1 ? 12 : M - 1, PY = M === 1 ? Y - 1 : Y;      // mes anterior
const NM = M === 12 ? 1 : M + 1, NY = M === 12 ? Y + 1 : Y;     // mes siguiente
const prev = (d) => day(d, PM, PY);
const past = (d) => day(Math.min(d, D));                        // nunca en el futuro

const browser = await chromium.launch();

async function newContext() {
  const ctx = await browser.newContext({ viewport: VIEW, reducedMotion: "reduce" });
  await ctx.addInitScript((keys) => { for (const k of keys) localStorage.setItem(k, "1"); }, SEEN_KEYS);
  return ctx;
}

// Crea un usuario en el emulador desde /login y devuelve un cliente de la API con su token.
async function signUp(page, email) {
  await page.goto(APP + "/login");
  const token = await page.evaluate(async ({ email, password }) => {
    const w = window;
    await w.__e2e.ready;
    const cred = await w.__e2e.createUserWithEmailAndPassword(w.__e2e.auth, email, password);
    return cred.user.getIdToken();
  }, { email, password: PASSWORD });
  const H = { Authorization: `Bearer ${token}` };
  return async function api(method, p, data) {
    const res = await page.request.fetch(API + p, { method, headers: H, data });
    if (!res.ok()) throw new Error(`${method} ${p}: ${res.status()} ${await res.text()}`);
    return res.status() === 204 ? null : res.json();
  };
}

// ── Cuentas ───────────────────────────────────────────────────────────────────
const ctx = await newContext();
const page = await ctx.newPage();
const api = await signUp(page, `martin${N}@demo.local`);
const martin = await api("POST", "/auth/register", {
  tenant_name: "Casa Gómez", kind: "household", first_name: "Martín", last_name: "Gómez", alias: `martin.gomez${N}`,
});
await api("POST", "/auth/me/skip-whatsapp-gate");

const side = await newContext();
const sidePage = await side.newPage();
const ana = await signUp(sidePage, `ana${N}@demo.local`);
await ana("POST", "/auth/join", { tenant_code: martin.tenant_code, first_name: "Ana", last_name: "Gómez", alias: `ana.gomez${N}` });
await ana("POST", "/auth/me/skip-whatsapp-gate");
const lucia = await signUp(sidePage, `lucia${N}@demo.local`);
const luciaUser = await lucia("POST", "/auth/register", {
  tenant_name: "Casa de Lucía", kind: "household", first_name: "Lucía", last_name: "Fernández", alias: `lucia.fer${N}`,
});
await lucia("POST", "/auth/me/skip-whatsapp-gate");

// ── Categorías ────────────────────────────────────────────────────────────────
const COLORS = { Supermercado: "#22c55e", Servicios: "#3b82f6", Transporte: "#f59e0b", Salud: "#ef4444",
  Restaurantes: "#ec4899", Educación: "#8b5cf6", Hogar: "#14b8a6", Entretenimiento: "#f97316" };
let cats = await api("GET", "/expenses/categories");
async function cat(name) {
  let c = cats.find(x => x.name === name);
  if (!c) { c = await api("POST", "/expenses/categories", { name, color: COLORS[name] ?? "#6366f1", is_fixed: false }); cats.push(c); }
  return c.id;
}
for (const name of Object.keys(COLORS)) await cat(name);

// ── Ingresos con detalle ──────────────────────────────────────────────────────
const fieldsOf = (src) => Object.fromEntries(src.fields.map(f => [f.name, f.id]));
const sMartin = await api("POST", "/income/sources", { name: "Sueldo Martín", income_type: "salary", fields: [
  { name: "Bruto", kind: "add" }, { name: "Jubilación", kind: "subtract" },
  { name: "Obra social", kind: "subtract" }, { name: "Ganancias", kind: "subtract" }] });
const sAna = await api("POST", "/income/sources", { name: "Sueldo Ana", income_type: "salary", fields: [
  { name: "Bruto", kind: "add" }, { name: "Presentismo", kind: "add" },
  { name: "Jubilación", kind: "subtract" }, { name: "Obra social", kind: "subtract" }] });
const fM = fieldsOf(sMartin), fA = fieldsOf(sAna);
const income = (src, f, date, items, notes) => api("POST", "/income/entries", {
  source_id: src.id, period_date: date, notes,
  amount: Object.entries(items).reduce((s, [k, v]) => s + (["Bruto", "Presentismo"].includes(k) ? v : -v), 0),
  items: Object.entries(items).map(([k, v]) => ({ field_id: f[k], amount: v })),
});
await income(sMartin, fM, prev(5), { Bruto: 2780000, Jubilación: 305800, "Obra social": 83400, Ganancias: 132000 }, "Sueldo de agosto");
await income(sAna, fA, prev(5), { Bruto: 1780000, Presentismo: 140000, Jubilación: 211200, "Obra social": 57600 }, "Sueldo de agosto");
await income(sMartin, fM, past(5), { Bruto: 2900000, Jubilación: 319000, "Obra social": 87000, Ganancias: 145000 }, "Sueldo de septiembre");

// ── Egresos del mes (y algunos del anterior, para comparar) ───────────────────
const exp = (date, amount, category, description) =>
  api("POST", "/expenses/entries", { expense_date: date, amount, category_id: category, description });
for (const [d, amount, c, desc] of [
  [1, 86500, "Supermercado", "Coto"], [2, 48200, "Servicios", "Luz"], [3, 39900, "Servicios", "Internet y TV"],
  [4, 52000, "Transporte", "Nafta"], [6, 23400, "Salud", "Farmacia"], [7, 18700, "Supermercado", "Verdulería"],
  [8, 210000, "Educación", "Cuota del colegio"], [9, 34000, "Restaurantes", "Pizzería"], [10, 145000, "Servicios", "Expensas"],
]) await exp(past(d), amount, await cat(c), desc);
for (const [d, amount, c, desc] of [
  [2, 79800, "Supermercado", "Coto"], [3, 45100, "Servicios", "Luz"], [3, 39900, "Servicios", "Internet y TV"],
  [8, 210000, "Educación", "Cuota del colegio"], [10, 140000, "Servicios", "Expensas"], [15, 48000, "Transporte", "Nafta"],
  [21, 62000, "Restaurantes", "Parrilla"], [26, 91300, "Supermercado", "Coto"],
]) await exp(prev(d), amount, await cat(c), desc);

// ── Tarjetas ──────────────────────────────────────────────────────────────────
const visa = await api("POST", "/credit-cards", { bank: "BBVA", alias: "Visa", titular: "Martín Gómez", last_4_digits: "4821", due_day: 7 });
const master = await api("POST", "/credit-cards", { bank: "Galicia", alias: "Mastercard", titular: "Ana Gómez", last_4_digits: "1934", due_day: 10 });
const item = (card, y, m, body) => api("POST", `/credit-cards/${card.id}/items`, { year: y, month: m, item_type: "single", ...body });
await item(visa, PY, PM, { description: "Heladera Samsung", category_id: await cat("Hogar"), item_date: prev(8),
  item_type: "installment", amount: 95000, installment_count: 12 });
await item(visa, PY, PM, { description: "Zapatillas", category_id: await cat("Hogar"), item_date: prev(20), amount: 89990 });
await item(visa, PY, PM, { description: "Netflix", category_id: await cat("Entretenimiento"), item_date: prev(18), amount: 9999 });
await item(visa, Y, M, { description: "Jumbo", category_id: await cat("Supermercado"), item_date: past(4), amount: 112300 });
await item(visa, Y, M, { description: "Farmacity", category_id: await cat("Salud"), item_date: past(6), amount: 15800 });
await item(master, Y, M, { description: "Ropa de los chicos", category_id: await cat("Hogar"), item_date: past(6),
  item_type: "installment", amount: 41000, installment_count: 3 });
// Fechas reales de cierre y vencimiento, para el calendario.
const stmtOf = async (card, y, m) => (await api("GET", `/credit-cards/${card.id}/statements`)).find(s => s.year === y && s.month === m);
await api("PATCH", `/credit-cards/statements/${(await stmtOf(visa, PY, PM)).id}`, { closing_date: prev(25), due_date: day(7) });
const visaNow = await stmtOf(visa, Y, M);
await api("PATCH", `/credit-cards/statements/${visaNow.id}`, { closing_date: day(23), due_date: day(5, NM, NY) });
await api("PATCH", `/credit-cards/statements/${(await stmtOf(master, Y, M)).id}`, { closing_date: day(29), due_date: day(10, NM, NY) });

// ── Dólares ───────────────────────────────────────────────────────────────────
await api("POST", "/currency/operations", { op_type: "initial", operation_date: `${Y}-01-02`, foreign_amount: 2500 });
await api("POST", "/currency/operations", { op_type: "buy", operation_date: past(3), foreign_amount: 400,
  ars_amount: 622000, rate_type: "blue", entity: "Banco Galicia" });

// ── Hipoteca UVA (registra sola las cuotas ya vencidas) ───────────────────────
await api("POST", "/mortgage/loans", { loan_type: "uva_frances", description: "Depto Caballito", total_cuotas: 240,
  first_payment_date: "2025-02-10", payment_day: 10, cuota_uva: 380, tna: 4.5, original_capital_uva: 60000 });

// ── Compartidos con Lucía (ya aceptados: ningún diálogo pendiente para Martín) ─
const sh1 = await api("POST", "/shared-expenses", { title: "Cena de cumpleaños", total_amount: 96000,
  category_id: await cat("Restaurantes"), split_type: "equal", expense_date: past(4), splits: [
    { user_id: martin.id, member_name: "Martín Gómez", amount: 48000 },
    { user_id: luciaUser.id, member_name: "Lucía Fernández", amount: 48000 }] });
await lucia("POST", `/shared-expenses/${sh1.id}/accept`);
const lcats = await lucia("GET", "/expenses/categories");
const lcat = lcats[0]?.id ?? (await lucia("POST", "/expenses/categories", { name: "Salidas", color: "#f97316", is_fixed: false })).id;
const sh2 = await lucia("POST", "/shared-expenses", { title: "Entradas del recital", total_amount: 70000,
  category_id: lcat, split_type: "equal", expense_date: past(8), splits: [
    { user_id: luciaUser.id, member_name: "Lucía Fernández", amount: 35000 },
    { user_id: martin.id, member_name: "Martín Gómez", amount: 35000 }] });
await api("POST", `/shared-expenses/${sh2.id}/accept`);

// ── Recordatorios ─────────────────────────────────────────────────────────────
await api("POST", "/reminders", { title: "Pagar el seguro del auto", remind_date: TODAY });
await api("POST", "/reminders", { title: "Pagar ABL", remind_date: day(Math.min(D + 9, 28)) });
console.log("datos cargados para", `martin${N}@demo.local`);
await side.close();

// ── Reloj ─────────────────────────────────────────────────────────────────────
// Las capturas se sacan a media tarde de "hoy": a la noche, Divisas propone la
// fecha de mañana (usa la fecha UTC), y eso no es lo que ve quien usa la app de día.
await ctx.clock.setFixedTime(new Date(`${TODAY}T15:00:00-03:00`));

// ── Pantallas ─────────────────────────────────────────────────────────────────
const rec = recorder({ page, view: VIEW, outFile: `${WORK}/frames.json`, settleMs: 700 });
const { still, step } = rec;

const form = () => page.locator("form").last();
let t;
async function pick(flow, caption, combo, option, nextCaption) {
  await step(flow, caption, combo);
  await combo.click();
  const opt = page.getByRole("option", { name: option }).first();
  await step(flow, nextCaption, opt);
  await opt.click();
}

// El ingreso va antes que las pantallas: así Inicio ya muestra los dos sueldos del mes.
// Cargar un ingreso con su detalle.
await page.goto(APP + "/income");
await page.getByText("Sueldo Martín").first().waitFor();
t = page.getByRole("button", { name: "Registrar ingreso" });
await step("ingreso", "En Ingresos, tocá el botón +.", t);
await t.click();
await pick("ingreso", "Elegí la fuente.", form().getByRole("combobox").first(), /^Sueldo Ana/,
  "Cada fuente trae sus campos de detalle.");
t = form().getByLabel("Bruto", { exact: true });
await step("ingreso", "Copiá los montos del recibo: el bruto…", t);
await t.fill("1.850.000");
t = form().getByLabel("Presentismo", { exact: true });
await step("ingreso", "…lo que suma…", t);
await t.fill("150.000");
await form().getByLabel("Jubilación", { exact: true }).fill("220.000");
t = form().getByLabel("Obra social", { exact: true });
await step("ingreso", "…y lo que resta, como jubilación y obra social.", t);
await t.fill("60.000");
t = form().getByLabel("Neto", { exact: true });
await step("ingreso", "El neto se calcula solo: es lo que cobraste.", t);
t = form().getByRole("button", { name: "Guardar" });
await step("ingreso", "Tocá Guardar.", t);
await t.click();
t = page.getByRole("button", { name: /Sueldo Ana/ }).first();
await t.waitFor();
await step("ingreso", "El ingreso queda en el mes. Tocalo para ver el detalle.", t);
await t.click();
await page.getByText("Presentismo").first().waitFor();
await step("ingreso", "Ahí ves de dónde sale el neto: lo que suma y lo que resta.", null);

await page.goto(APP + "/dashboard");
await page.getByText(/Cierre de /).first().waitFor({ timeout: 20000 });
await page.getByText("Egresos por categoría").first().waitFor({ timeout: 15000 });
await still("inicio");
await page.getByRole("button", { name: /Ver detalle/ }).first().click();
await still("inicio-detalle");
await page.mouse.wheel(0, 700);
await still("inicio-graficos");

for (const [p, name, ready] of [
  ["/income", "ingresos", "Sueldo Martín"],
  ["/expenses", "egresos", "Cuota del colegio"],
  ["/divisas", "divisas", "Tenencia en dólares"],
  ["/mortgage", "hipoteca", "Historial de cuotas"],
  ["/shared", "compartidos", "Cena de cumpleaños"],
  ["/tarjetas", "tarjetas", "Mastercard"],
  [`/tarjetas/${visa.id}/${visaNow.id}`, "resumen", "Heladera Samsung"],
  ["/calendario", "calendario", "Calendario de pagos"],
  ["/settings", "configuracion", "Miembros"],
]) {
  await page.goto(APP + p);
  await page.getByText(ready).first().waitFor({ timeout: 15000 });
  await still(name);
}

// El detalle de un ingreso, con sus campos.
await page.goto(APP + "/income");
await page.getByRole("button", { name: /Sueldo Martín/ }).first().click();
await page.getByText("Jubilación").first().waitFor();
await still("ingreso-detalle");

// Lo compartido con una persona: el balance entre los dos.
await page.goto(APP + "/shared");
await page.getByText("Cena de cumpleaños").first().waitFor();
await page.getByRole("button", { name: /Lucía/ }).first().click();
await page.getByText("Balance").first().waitFor();
await still("compartidos-persona");
rec.save();

// ── Flujos ─────────────────────────────────────────────────────────────────────
// 1. Cargar un gasto.
await page.goto(APP + "/expenses");
await page.getByText("Cuota del colegio").first().waitFor();
t = page.getByRole("button", { name: "Registrar egreso" });
await step("gasto", "En Egresos, tocá el botón +.", t);
await t.click();
await pick("gasto", "Elegí la categoría.", form().getByRole("combobox").first(), "Supermercado", "Por ejemplo, Supermercado.");
t = form().getByLabel("Monto", { exact: true });
await step("gasto", "La fecha ya viene con la de hoy. Escribí el monto.", t);
await t.fill("27.500");
t = form().getByLabel("Descripción");
await step("gasto", "Si querés, sumá una descripción.", t);
await t.fill("Carnicería");
t = form().getByRole("button", { name: "Guardar" });
await step("gasto", "Con Efectivo o débito elegido, tocá Guardar.", t);
await t.click();
await page.getByText("Carnicería").first().waitFor();
await step("gasto", "Listo: el gasto queda en la lista del mes.", null);

// 2. Compartir un gasto.
await page.goto(APP + "/expenses");
await page.getByText("Cuota del colegio").first().waitFor();
t = page.getByRole("button", { name: "Registrar egreso" });
await step("compartir", "En Egresos, tocá + como en cualquier gasto.", t);
await t.click();
await form().getByRole("combobox").first().click();
await page.getByRole("option", { name: "Transporte" }).first().click();
await form().getByLabel("Monto", { exact: true }).fill("64.000");
t = form().getByLabel("Descripción");
await step("compartir", "Cargá categoría, monto y una descripción: al compartir es obligatoria.", t);
await t.fill("Nafta del viaje a la costa");
t = form().getByRole("group", { name: "¿Lo compartís?" }).getByRole("button", { name: "Sí" });
await step("compartir", "En ¿Lo compartís?, tocá Sí.", t);
await t.click();
t = form().getByRole("button", { name: "Agregar persona" });
await step("compartir", "Vos ya estás en la lista. Tocá Agregar persona.", t);
await t.click();
t = page.locator("[aria-label='Elegir con quién compartir']").getByText("Lucía Fernández").first();
await step("compartir", "Buscá por nombre, alias, mail o teléfono, o elegí a alguien con quien ya compartiste.", t);
await t.click();
t = form().getByRole("button", { name: "Guardar" });
await step("compartir", "En partes iguales, cada uno pone la mitad. Tocá Guardar.", t);
await t.click();
t = page.getByRole("button", { name: "Ver en Compartidos" });
await t.waitFor();
await step("compartir", "Se guarda tu parte como gasto. Desde el aviso vas a Compartidos.", t);
await t.click();
await page.getByText("Nafta del viaje a la costa").first().waitFor();
await step("compartir", "Lucía lo ve en su app para aceptarlo, y el balance entre ustedes se actualiza.", null);

// 3. Comprar dólares.
await page.goto(APP + "/divisas");
await page.getByText("Tenencia en dólares").first().waitFor();
t = page.getByRole("button", { name: "Nueva operación" });
await step("dolares", "En Divisas, tocá el botón +.", t);
await t.click();
t = form().locator("input[inputmode='decimal']").first();
await step("dolares", "Ya viene en Compra. Escribí cuántos dólares compraste.", t);
await t.fill("200");
t = form().getByRole("button", { name: /^Blue/ });
await step("dolares", "Elegí la cotización, o escribí la que pagaste.", t);
await t.click();
t = form().getByRole("button", { name: "Guardar" });
await step("dolares", "Los pesos se calculan solos. Tocá Guardar.", t);
await t.click();
await wait(1200);
await step("dolares", "La tenencia suma los dólares. No cuenta como gasto: los pesos cambiaron de bolsillo.", null);

// 4. Un consumo con tarjeta en cuotas.
await page.goto(APP + "/expenses");
await page.getByText("Cuota del colegio").first().waitFor();
t = page.getByRole("button", { name: "Registrar egreso" });
await step("cuotas", "En Egresos, tocá el botón +.", t);
await t.click();
await form().getByRole("combobox").first().click();
await page.getByRole("option", { name: "Hogar" }).first().click();
t = form().getByLabel("Descripción");
await step("cuotas", "Elegí la categoría y escribí qué compraste.", t);
await t.fill("Colchón");
t = form().getByRole("group", { name: "Pago" }).getByRole("button", { name: "Tarjeta" });
await step("cuotas", "En Pago, tocá Tarjeta.", t);
await t.click();
await pick("cuotas", "Elegí la tarjeta.", form().getByRole("combobox").nth(1), /^Visa · BBVA/,
  "El mes del resumen sigue a la fecha de compra: cambialo si compraste después del cierre.");
t = form().getByRole("group", { name: "Forma de pago con tarjeta" }).getByRole("button", { name: "En cuotas" });
await step("cuotas", "Tocá En cuotas…", t);
await t.click();
t = form().getByLabel("Cantidad de cuotas");
await step("cuotas", "…y poné cuántas.", t);
await t.fill("6");
t = form().getByLabel("Monto por cuota");
await step("cuotas", "Escribí el monto de cada cuota. Abajo ves el total de la compra.", t);
await t.fill("45.000");
t = form().getByRole("button", { name: "Guardar" });
await step("cuotas", "Tocá Guardar.", t);
await t.click();
t = page.getByRole("button", { name: "Ver resumen" });
await t.waitFor();
await step("cuotas", "Queda en el resumen de la tarjeta. Las otras 5 cuotas ya están en los próximos.", t);
await t.click();
await page.getByText("Colchón").first().waitFor();
await page.mouse.move(5, 795);
await step("cuotas", "En el resumen ves la cuota 1 de 6 junto al resto de las compras.", null);

rec.save();
await browser.close();
