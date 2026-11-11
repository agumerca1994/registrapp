// Instructivo de RegistrApp Hogar: crea una cuenta de demo en la app LOCAL,
// carga datos de ejemplo por la API y captura pantallas y flujos.
// Requiere `docker compose up` y `npm run emulator` (frontend/). Uso:
//   node tools/instructivo/hogar/capture.mjs
//   python3 ~/.claude/agents/instructivo-kit/build_deck.py tools/instructivo/hogar/deck.json
// Ver .claude/instructivo/registrapp.md y el agente instructivo-builder.
// Salidas, fuera del repo, en /private/tmp/registrapp-instructivo/hogar/:
// frames.json (lo que lee deck.json) y landing/ (las imágenes de /hogar, de
// la home y la del celular, que se copian a mano a frontend/public/).
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
// "Hoy" en la Argentina, igual que services/clock.ar_today(). A principio de mes
// todo el mes cae en uno o dos días: se usa el 15 del mes anterior (o INSTRUCTIVO_HOY).
// Siempre en el pasado, porque el backend recorta la tenencia y la hipoteca a su hoy real.
function referenceDay(real) {
  if (process.env.INSTRUCTIVO_HOY) return process.env.INSTRUCTIVO_HOY;
  const [y, m, d] = real.split("-").map(Number);
  if (d >= 8) return real;
  return m === 1 ? `${y - 1}-12-15` : `${y}-${String(m - 1).padStart(2, "0")}-15`;
}
const TODAY = referenceDay(new Date().toLocaleString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" }).slice(0, 10));
const [Y, M, D] = TODAY.split("-").map(Number);
const pad = (n) => String(n).padStart(2, "0");
const day = (d, m = M, y = Y) => `${y}-${pad(m)}-${pad(d)}`;
const PM = M === 1 ? 12 : M - 1, PY = M === 1 ? Y - 1 : Y;      // mes anterior
const NM = M === 12 ? 1 : M + 1, NY = M === 12 ? Y + 1 : Y;     // mes siguiente
const prev = (d) => day(d, PM, PY);
const past = (d) => day(Math.min(d, D));                        // nunca en el futuro
const monthsBack = (k) => { const i = Y * 12 + (M - 1) - k; return [(i % 12) + 1, Math.floor(i / 12)]; }; // [mes, año]
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const monthName = (k) => MONTHS[monthsBack(k)[0] - 1];
const shiftDays = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// Con GPU, Playwright dibuja el vidrio (backdrop-filter) también a 2×: sin estas
// banderas la barra de abajo del celular salía transparente en las capturas a 2×.
const browser = await chromium.launch({ args: ["--enable-gpu", "--ignore-gpu-blocklist"] });

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
await income(sMartin, fM, prev(5), { Bruto: 2780000, Jubilación: 305800, "Obra social": 83400, Ganancias: 132000 }, `Sueldo de ${monthName(2)}`);
await income(sAna, fA, prev(5), { Bruto: 1780000, Presentismo: 140000, Jubilación: 211200, "Obra social": 57600 }, `Sueldo de ${monthName(2)}`);
await income(sMartin, fM, past(5), { Bruto: 2900000, Jubilación: 319000, "Obra social": 87000, Ganancias: 145000 }, `Sueldo de ${monthName(1)}`);

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
await api("POST", "/currency/operations", { op_type: "initial", operation_date: `${Y}-01-02`, foreign_amount: 4800 });
await api("POST", "/currency/operations", { op_type: "buy", operation_date: past(3), foreign_amount: 400,
  ars_amount: 622000, rate_type: "blue", entity: "Banco Galicia" });

// ── Créditos (registran solas las cuotas ya vencidas) ─────────────────────────
// La hipoteca UVA arranca en 2025: sólo hay UVA en macro_variables desde ahí.
const hipoteca = await api("POST", "/credits", { kind: "hipotecario", adjustment: "uva", amortization: "frances",
  method: "cuota", description: "Depto Caballito", total_cuotas: 240, first_payment_date: "2025-02-10",
  payment_day: 10, cuota_uva: 210, tna: 4.5, original_capital_uva: 60000 });
await api("POST", "/credits", { kind: "personal", adjustment: "fija", amortization: "frances", method: "cuota",
  description: "Arreglo del baño", total_cuotas: 18, first_payment_date: day(5, ...monthsBack(6)),
  payment_day: 5, cuota_pesos: 98500, tna: 62 });

// ── Objetivos ─────────────────────────────────────────────────────────────────
// Sin aporte este mes y con el día 10 pasado: Inicio pide la cuota del mes.
const viaje = await api("POST", "/savings/goals", { name: "Vacaciones en Brasil", currency: "USD", target_amount: 3000,
  target_date: `${Y + 1}-03-31`, plan_amount: 300, plan_day: 10 });
await api("POST", `/savings/goals/${viaje.id}/contributions`,
  { amount: 900, contribution_date: day(20, ...monthsBack(4)), note: "Lo que ya tenía" });
for (const k of [3, 2, 1]) await api("POST", `/savings/goals/${viaje.id}/contributions`,
  { amount: 300, contribution_date: day(10, ...monthsBack(k)) });
await api("POST", "/savings/goals", { name: "Fondo de emergencia", currency: "ARS", target_amount: 3000000,
  initial_amount: 1450000 });
await api("POST", "/savings/goals", { name: "Cambiar el auto", currency: "USD", target_amount: 8000,
  target_date: `${Y + 2}-06-30`, initial_amount: 2600 });

// ── Inversiones ───────────────────────────────────────────────────────────────
// Las fechas son del backend (su hoy real): el plazo fijo vence después de hoy.
await api("POST", "/investments", { name: "Plazo fijo Galicia", kind: "plazo_fijo", currency: "ARS",
  institution: "Banco Galicia", tna: 33, start_date: shiftDays(TODAY, -16), maturity_date: shiftDays(TODAY, 14),
  amount: 2000000 });
await api("POST", "/investments", { name: "Fondo money market", kind: "fci", currency: "ARS",
  institution: "Banco Galicia", start_date: day(1, ...monthsBack(5)), amount: 1200000, current_value: 1318400 });
await api("POST", "/investments", { name: "Cuenta remunerada", kind: "cuenta", currency: "ARS",
  institution: "Naranja X", tna: 29, start_date: day(1, ...monthsBack(2)), amount: 450000 });
await api("POST", "/investments", { name: "CEDEARs", kind: "acciones", currency: "USD",
  start_date: day(1, ...monthsBack(14)), amount: 3500, current_value: 4120 });

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
const sh3 = await api("POST", "/shared-expenses", { title: "Regalo para Sofi", total_amount: 54000,
  category_id: await cat("Entretenimiento"), split_type: "equal", expense_date: past(9), splits: [
    { user_id: martin.id, member_name: "Martín Gómez", amount: 27000 },
    { user_id: luciaUser.id, member_name: "Lucía Fernández", amount: 27000 }] });
await lucia("POST", `/shared-expenses/${sh3.id}/accept`);
const sh4 = await lucia("POST", "/shared-expenses", { title: "Super para el asado", total_amount: 88000,
  category_id: lcat, split_type: "equal", expense_date: prev(24), splits: [
    { user_id: luciaUser.id, member_name: "Lucía Fernández", amount: 44000 },
    { user_id: martin.id, member_name: "Martín Gómez", amount: 44000 }] });
await api("POST", `/shared-expenses/${sh4.id}/accept`);

// ── Recordatorios ─────────────────────────────────────────────────────────────
await api("POST", "/reminders", { title: "Pagar el seguro del auto", remind_date: TODAY });
await api("POST", "/reminders", { title: "Pagar ABL", remind_date: day(Math.min(D + 9, 28)) });
console.log("datos cargados para", `martin${N}@demo.local`);
await side.close();

// ── Reloj ─────────────────────────────────────────────────────────────────────
// Las capturas se sacan a media tarde de "hoy": a la noche, Divisas propone la
// fecha de mañana (usa la fecha UTC), y eso no es lo que ve quien usa la app de día.
await ctx.clock.setFixedTime(new Date(`${TODAY}T15:00:00-03:00`));

if (process.env.EXPLORE) {
  const dir = `${WORK}/explore`; fs.mkdirSync(dir, { recursive: true });
  await ctx.storageState({ path: `${WORK}/state.json` });
  const routes = process.env.EXPLORE.split(",");
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true,
    hasTouch: true, reducedMotion: "reduce", storageState: `${WORK}/state.json` });
  await mob.addInitScript((keys) => { for (const k of keys) localStorage.setItem(k, "1"); }, SEEN_KEYS);
  const mp = await mob.newPage();
  for (const r of routes) {
    const n = r.replace(/[^a-z0-9]+/gi, "_");
    await page.goto(APP + r); await wait(3500); await page.screenshot({ path: `${dir}/d${n}.png`, fullPage: true });
    await mp.goto(APP + r); await wait(3500); await mp.screenshot({ path: `${dir}/m${n}.png`, scale: "css", fullPage: true });
  }
  console.log("explore listo", `martin${N}@demo.local`);
  await browser.close(); process.exit(0);
}

// ── Grabadores ────────────────────────────────────────────────────────────────
// Escritorio: lo que lee build_deck.py. Celular: los flujos que se hacen con el +
// de la barra de abajo (sólo existe en el celular) se graban en una página de
// 390×844 y se componen dentro de un cuadro de 1280×800, con forma de teléfono,
// porque el instructivo tiene una sola proporción para todas sus capturas.
const rec = recorder({ page, view: VIEW, outFile: `${WORK}/frames.json`, settleMs: 700 });
const { still, step } = rec;
const LAND = `${WORK}/landing`;
fs.mkdirSync(LAND, { recursive: true });
const land = (name, clip) => page.screenshot({ path: `${LAND}/${name}.jpg`, type: "jpeg", quality: 84, ...(clip ? { clip } : {}) });
const CLIP_776 = { x: 0, y: 24, width: 1280, height: 776 };
const sheet = (name) => page.getByRole("dialog", { name });

await ctx.storageState({ path: `${WORK}/state.json` });
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true,
  hasTouch: true, reducedMotion: "reduce", storageState: `${WORK}/state.json` });
await mctx.addInitScript((keys) => { for (const k of keys) localStorage.setItem(k, "1"); }, SEEN_KEYS);
await mctx.clock.setFixedTime(new Date(`${TODAY}T15:00:00-03:00`));
const mp = await mctx.newPage();
const msheet = (name) => mp.getByRole("dialog", { name });

const comp = await ctx.newPage();
const prec = recorder({ page: comp, view: VIEW, outFile: `${WORK}/frames-phone.json`, settleMs: 0 });
const PH = { h: 736 };
PH.w = Math.round(PH.h * 390 / 844);
function phoneHtml(png, box) {
  const k = PH.w / 390;
  const tap = box ? `<i id="tap" style="left:${(box.x + box.width / 2) * k - 2}px;top:${(box.y + box.height / 2) * k - 2}px"></i>` : "";
  return `<!doctype html><html><body style="margin:0;width:1280px;height:800px;background:#ebe7df;display:flex;align-items:center;justify-content:center">
  <div style="position:relative;padding:10px;border-radius:52px;background:#1e1a2e">
  <div style="position:relative;width:${PH.w}px;height:${PH.h}px;border-radius:42px;overflow:hidden">
  <img src="data:image/png;base64,${png}" style="display:block;width:100%;height:100%">${tap}</div></div>
  <style>#tap{position:absolute;width:4px;height:4px}</style></body></html>`;
}
async function pstep(flow, caption, target = null) {
  await wait(800);
  let box = null;
  if (target) { await target.scrollIntoViewIfNeeded().catch(() => {}); box = await target.boundingBox(); }
  const png = (await mp.screenshot({ type: "png", scale: "css" })).toString("base64");
  await comp.setContent(phoneHtml(png, box));
  await comp.locator("img").evaluate(i => i.decode());
  await prec.step(flow, caption, box ? comp.locator("#tap") : null);
}
async function ppick(flow, caption, combo, option, nextCaption) {
  await pstep(flow, caption, combo);
  await combo.click();
  const opt = mp.getByRole("option", { name: option }).first();
  await pstep(flow, nextCaption, opt);
  await opt.click();
}
async function pick(flow, caption, combo, option, nextCaption) {
  await step(flow, caption, combo);
  await combo.click();
  const opt = page.getByRole("option", { name: option }).first();
  await step(flow, nextCaption, opt);
  await opt.click();
}
let t;

// ── Flujos en el celular ──────────────────────────────────────────────────────
// El ingreso va antes que las pantallas: así Inicio ya muestra los dos sueldos del mes.
await mp.goto(APP + "/dashboard");
await mp.getByText("Lo que viene").first().waitFor({ timeout: 20000 });
t = mp.getByRole("button", { name: "Agregar" });
await pstep("ingreso", "Tocá el + de la barra de abajo.", t);
await t.click();
t = mp.getByRole("button", { name: /Me entró plata/ });
await pstep("ingreso", "Elegí Me entró plata.", t);
await t.click();
let f = msheet("Nuevo ingreso");
await f.waitFor();
await ppick("ingreso", "Elegí la fuente.", f.getByRole("combobox").first(), /^Sueldo Ana/,
  "Cada fuente trae sus campos de detalle.");
t = f.getByLabel("Bruto", { exact: true });
await pstep("ingreso", "Copiá los montos del recibo: el bruto…", t);
await t.fill("1.850.000");
t = f.getByLabel("Presentismo", { exact: true });
await pstep("ingreso", "…lo que suma…", t);
await t.fill("150.000");
await f.getByLabel("Jubilación", { exact: true }).fill("220.000");
t = f.getByLabel("Obra social", { exact: true });
await pstep("ingreso", "…y lo que resta, como jubilación y obra social.", t);
await t.fill("60.000");
t = f.getByLabel("Neto", { exact: true });
await pstep("ingreso", "Arriba, el neto se calcula solo: es lo que cobraste.", t);
t = f.getByRole("button", { name: "Guardar ingreso" });
await pstep("ingreso", "Tocá Guardar ingreso.", t);
await t.click();
await f.waitFor({ state: "detached" });
await wait(3500); // que se vaya el aviso de la t, que tapa el detalle
t = mp.locator("button[data-no-press]", { hasText: "Sueldo Ana" }).first();
await t.waitFor();
await pstep("ingreso", "Queda en Movimientos, en Ingresos. Tocalo para ver el detalle.", t);
await t.click();
await mp.getByText("Presentismo").first().waitFor();
await pstep("ingreso", "Ahí ves de dónde sale el neto: lo que suma y lo que resta.", null);

// Un gasto, desde el +.
await mp.goto(APP + "/dashboard");
await mp.getByText("Lo que viene").first().waitFor({ timeout: 20000 });
t = mp.getByRole("button", { name: "Agregar" });
await pstep("gasto", "Tocá el + de la barra de abajo.", t);
await t.click();
t = mp.getByRole("button", { name: /Gasté/ });
await pstep("gasto", "¿Qué pasó? Gasté.", t);
await t.click();
f = msheet("Nuevo egreso");
await f.waitFor();
t = f.getByLabel("Monto", { exact: true });
await pstep("gasto", "Escribí el monto. La fecha ya viene con la de hoy.", t);
await t.fill("27.500");
await ppick("gasto", "Elegí la categoría.", f.getByRole("combobox").first(), "Supermercado", "Por ejemplo, Supermercado.");
t = f.getByLabel("Descripción");
await pstep("gasto", "Si querés, sumá una descripción.", t);
await t.fill("Carnicería");
t = f.getByRole("button", { name: "Guardar egreso" });
await pstep("gasto", "Con Efectivo o débito elegido, tocá Guardar egreso.", t);
await t.click();
await f.waitFor({ state: "detached" });
await mp.getByText("Carnicería").first().waitFor();
await wait(600);
await pstep("gasto", "Listo: el gasto queda en Movimientos, en el día de hoy.", null);
prec.save();

// ── Pantallas (escritorio) ────────────────────────────────────────────────────
await page.goto(APP + "/dashboard");
await page.getByText("Lo que viene").first().waitFor({ timeout: 20000 });
await wait(1500);
await still("inicio");
await land("inicio");

// La landing del celular: Inicio a 390×844, 2×.
await mp.goto(APP + "/dashboard");
await mp.getByText("Lo que viene").first().waitFor({ timeout: 20000 });
await wait(1500);
await mp.screenshot({ path: `${LAND}/celular-hogar.jpg`, type: "jpeg", quality: 84 });

for (const [p, name, ready] of [
  ["/expenses", "egresos", "Cuota del colegio"],
  ["/income", "ingresos", "Sueldo Martín"],
  ["/divisas", "divisas", "Tenés hoy"],
  ["/creditos", "creditos", "Tus créditos"],
  [`/creditos/${hipoteca.id}`, "credito", "Depto Caballito"],
  ["/objetivos", "objetivos", "Tus objetivos"],
  [`/objetivos/${viaje.id}`, "objetivo", "Vacaciones en Brasil"],
  ["/inversiones", "inversiones", "Dónde está"],
  ["/shared", "compartidos", "Cena de cumpleaños"],
  ["/tarjetas", "tarjetas", "Mastercard"],
  [`/tarjetas/${visa.id}/${visaNow.id}`, "resumen", "Heladera Samsung"],
  ["/calendario", "calendario", "Agregar recordatorio"],
  ["/settings", "configuracion", "Sumar gente"],
]) {
  await page.goto(APP + p);
  await page.getByText(ready).first().waitFor({ timeout: 15000 });
  await wait(800);
  await still(name);
  if (["divisas", "creditos", "objetivos", "inversiones"].includes(name)) await land(name);
}

// El detalle de un ingreso, con sus campos.
await page.goto(APP + "/income");
await page.locator("button[data-no-press]", { hasText: "Sueldo Ana" }).first().click();
await page.getByText("Presentismo").first().waitFor();
await still("ingreso-detalle");
await land("ingreso", CLIP_776);

// Lo compartido con una persona: el balance entre los dos.
await page.goto(APP + "/shared");
await page.getByText("Cena de cumpleaños").first().waitFor();
await page.getByRole("radio", { name: "Lucía Fernández" }).click();
await wait(1500);
await still("compartidos-persona");
await land("compartidos");
rec.save();

// ── Flujos (escritorio) ───────────────────────────────────────────────────────
// 1. Compartir un gasto.
await page.goto(APP + "/expenses");
await page.getByText("Cuota del colegio").first().waitFor();
t = page.getByRole("button", { name: "Registrar egreso" });
await step("compartir", "En Movimientos, tocá + como en cualquier gasto.", t);
await t.click();
f = sheet("Nuevo egreso");
await f.getByLabel("Monto", { exact: true }).fill("64.000");
await f.getByRole("combobox").first().click();
await page.getByRole("option", { name: "Transporte" }).first().click();
t = f.getByLabel("Descripción");
await step("compartir", "Cargá monto, categoría y una descripción: al compartir es obligatoria.", t);
await t.fill("Nafta del viaje a la costa");
t = f.getByRole("group", { name: "¿Lo compartís?" }).getByRole("button", { name: "Sí" });
await step("compartir", "En ¿Lo compartís?, tocá Sí.", t);
await t.click();
t = f.getByRole("button", { name: "Agregar persona" });
await step("compartir", "Vos ya estás en la lista. Tocá Agregar persona.", t);
await t.click();
t = sheet("Elegir con quién compartir").getByText("Lucía Fernández").first();
await step("compartir", "Buscá por nombre, alias, mail o teléfono, o elegí a alguien con quien ya compartiste.", t);
await t.click();
t = f.getByRole("button", { name: "Guardar egreso" });
await t.scrollIntoViewIfNeeded();
await f.getByText("Lucía Fernández").first().scrollIntoViewIfNeeded();
await wait(700);
await land("nuevo-gasto", CLIP_776);
await step("compartir", "En partes iguales, cada uno pone la mitad. Tocá Guardar egreso.", t);
await t.click();
t = page.getByRole("button", { name: "Ver en Compartidos" });
await t.waitFor();
await step("compartir", "Se guarda tu parte como gasto. Desde el aviso vas a Compartidos.", t);
await t.click();
await page.getByText("Nafta del viaje a la costa").first().waitFor();
await step("compartir", "Lucía lo ve en su app para aceptarlo, y las cuentas entre ustedes se actualizan.", null);

// 2. Un consumo con tarjeta en cuotas.
await page.goto(APP + "/expenses");
await page.getByText("Cuota del colegio").first().waitFor();
t = page.getByRole("button", { name: "Registrar egreso" });
await step("cuotas", "En Movimientos, tocá +.", t);
await t.click();
f = sheet("Nuevo egreso");
await f.getByRole("combobox").first().click();
await page.getByRole("option", { name: "Hogar" }).first().click();
t = f.getByLabel("Descripción");
await step("cuotas", "Elegí la categoría y escribí qué compraste.", t);
await t.fill("Colchón");
t = f.getByRole("group", { name: "Pago" }).getByRole("button", { name: "Tarjeta" });
await step("cuotas", "En Pago, tocá Tarjeta.", t);
await t.click();
await pick("cuotas", "Elegí la tarjeta.", f.getByRole("combobox").nth(1), /^Visa/,
  "El mes del resumen sigue a la fecha de compra: cambialo si compraste después del cierre.");
t = f.getByRole("group", { name: "Forma de pago con tarjeta" }).getByRole("button", { name: "En cuotas" });
await step("cuotas", "Tocá En cuotas…", t);
await t.click();
t = f.getByLabel("Cantidad de cuotas");
await step("cuotas", "…y poné cuántas.", t);
await t.fill("6");
t = f.getByLabel("Monto por cuota");
await step("cuotas", "Arriba, escribí el monto de cada cuota. Abajo ves el total de la compra.", t);
await t.fill("45.000");
await f.getByLabel("Cantidad de cuotas").scrollIntoViewIfNeeded();
t = f.getByRole("button", { name: "Guardar egreso" });
await step("cuotas", "Tocá Guardar egreso.", t);
await t.click();
t = page.getByRole("button", { name: "Ver resumen" });
await t.waitFor();
await step("cuotas", "Queda en el resumen de la tarjeta. Las otras 5 cuotas ya están en los próximos.", t);
await t.click();
await page.getByText("Colchón").first().waitFor();
await page.mouse.move(5, 795);
await step("cuotas", "En el resumen ves la cuota 1 de 6 junto al resto de las compras.", null);

// 3. Comprar dólares.
await page.goto(APP + "/divisas");
await page.getByText("Tenés hoy").first().waitFor();
t = page.getByRole("button", { name: "Nueva operación" });
await step("dolares", "En Divisas, tocá +.", t);
await t.click();
f = sheet("Nueva operación");
t = f.getByLabel("Dólares que compré");
await step("dolares", "Ya viene en Compra. Escribí cuántos dólares compraste.", t);
await t.fill("200");
t = f.getByRole("radio", { name: /^Blue/ });
await step("dolares", "Elegí la cotización, o escribí la que pagaste.", t);
await t.click();
t = f.getByRole("button", { name: "Guardar operación" });
await step("dolares", "Los pesos se calculan solos. Tocá Guardar operación.", t);
await t.click();
await f.waitFor({ state: "detached" });
await wait(1200);
await step("dolares", "Tenés 200 dólares más. No cuenta como gasto: los pesos cambiaron de bolsillo.", null);

// 4. Un objetivo nuevo.
await page.goto(APP + "/objetivos");
await page.getByText("Tus objetivos").first().waitFor();
t = page.getByRole("button", { name: "Objetivo", exact: true });
await step("objetivo", "En Objetivos, tocá + Objetivo.", t);
await t.click();
f = sheet("Nuevo objetivo");
t = f.getByLabel("¿Cuánto querés juntar?");
await step("objetivo", "¿Cuánto querés juntar? Elegí si es en dólares o en pesos.", t);
await t.fill("1.500");
t = f.getByLabel("Para qué es");
await step("objetivo", "Ponele un nombre.", t);
await t.fill("Una compu nueva");
t = f.getByRole("group", { name: "Cómo lo vas a juntar" }).getByRole("button", { name: "Todos los meses" });
await step("objetivo", "Si vas a apartar lo mismo cada mes, elegí Todos los meses.", t);
await t.click();
t = f.getByLabel("Por mes");
await step("objetivo", "Poné cuánto por mes y qué día.", t);
await t.fill("250");
await f.getByLabel("El día").fill("15");
t = f.getByRole("button", { name: "Crear objetivo" });
await step("objetivo", "Te dice cuándo llegás. Tocá Crear objetivo.", t);
await t.click();
await f.waitFor({ state: "detached" });
await page.getByText("Una compu nueva").first().waitFor();
await wait(800);
await step("objetivo", "Listo: ese día de cada mes Inicio te recuerda el aporte.", null);

// 5. Un plazo fijo.
await page.goto(APP + "/inversiones");
await page.getByText("Dónde está").first().waitFor();
t = page.getByRole("button", { name: "Inversión", exact: true });
await step("inversion", "En Inversiones, tocá + Inversión.", t);
await t.click();
t = sheet("¿Qué inversión es?").getByRole("button", { name: /^Plazo fijo/ });
await step("inversion", "Elegí qué es: plazo fijo, cuenta, fondo, acciones, cripto o efectivo.", t);
await t.click();
f = sheet("Los datos");
t = f.getByLabel("¿Cuánto pusiste?");
await step("inversion", "¿Cuánto pusiste?", t);
await t.fill("1.000.000");
t = f.locator("#inv-inst");
await step("inversion", "El banco…", t);
await t.fill("Banco Nación");
t = f.locator("#inv-tna");
await step("inversion", "…y la tasa que te dio (TNA).", t);
await t.fill("32");
t = f.getByText(/Al vencer vas a tener/);
await step("inversion", "Vence en 30 días, o elegí otra fecha. Ya ves cuánto vas a tener al vencer.", t);
t = f.getByRole("button", { name: "Guardar" });
await step("inversion", "Tocá Guardar.", t);
await t.click();
await f.waitFor({ state: "detached" });
await page.getByText("Plazo fijo Banco Nación").first().waitFor().catch(() => {});
await wait(1000);
await step("inversion", "Lo que rinde se calcula solo, día a día, hasta que vence.", null);

// Los flujos del celular van en el mismo frames.json: ya tienen el cuadro de 1280×800.
Object.assign(rec.out.flows, prec.out.flows);
rec.save();
await browser.close();
