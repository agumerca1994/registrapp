import { test, expect } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * El camino de alta rápida, de punta a punta.
 *
 * Es el único spec de flujo del repo, y existe porque `/registrar` es el
 * destino de todos los canales de carga (hoja de compartir, Atajo de iOS, deep
 * link del bot): si esta pantalla se rompe, se rompen todos a la vez y el
 * smoke —que sólo comprueba que la ruta renderiza— no se entera.
 *
 * **No deja nada atrás**: deshace el gasto que crea y reusa una categoría
 * existente en vez de acuñar una por corrida. Un test que ensucia la base es
 * un test que se termina desactivando.
 */
test("registrar un gasto y deshacerlo", async ({ page }) => {
  // La CSP del proyecto está a propósito en Report-Only (ver next.config.ts) y
  // el navegador avisa en cada carga. No es de esta pantalla.
  const KNOWN = /upgrade-insecure-requests.*report-only/;
  const errors: string[] = [];
  page.on("console", m => { if (m.type() === "error" && !KNOWN.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", e => errors.push(`pageerror: ${e.message}`));

  // Prellenado por querystring, tal como llega desde la hoja de compartir.
  // El monto va en formato argentino a propósito: `parseFloat("777,77")` da 7.
  await page.goto("/registrar?amount=12.500,50&description=Coto+Bulnes&source=share_target");
  await expect(page.getByRole("heading", { name: "Registrar gasto" })).toBeVisible();
  await expect(page.getByLabel("Monto")).toHaveValue("12.500,50");
  await expect(page.getByPlaceholder("Dónde fue")).toHaveValue("Coto Bulnes");
  await expect(page.getByText("Hoy", { exact: true })).toBeVisible();

  // Categoría: chips, con la puerta al selector completo siempre presente.
  const empty = page.getByRole("button", { name: "+ Crear la primera" });
  const chips = page.getByRole("radiogroup", { name: "Categoría" });
  await expect(empty.or(chips).first()).toBeVisible();
  if (await empty.isVisible()) {
    // Sólo en un hogar sin ninguna categoría. Se crea una vez y las corridas
    // siguientes la reusan.
    await empty.click();
    await page.getByPlaceholder("Supermercado").fill("Varios");
    await page.getByRole("button", { name: "Crear", exact: true }).click();
  }
  await expect(chips).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver todas" })).toBeVisible();
  await chips.getByRole("radio").first().click();

  await page.getByRole("button", { name: "Guardar gasto" }).click();
  await expect(page.getByRole("button", { name: "Registrar otro" })).toBeVisible();
  await expect(page.getByText("$ 12.500,50")).toBeVisible();

  // Llegó a la lista. En una pestaña aparte: navegar y volver remonta React y
  // pierde la confirmación, que es lo correcto — "Deshacer" es del momento.
  const tab = await page.context().newPage();
  await tab.goto("/expenses");
  await expect(tab.getByText("Coto Bulnes").first()).toBeVisible();
  await expect(tab.getByText("$ 12.500,50").first()).toBeVisible();

  // Deshacer lo borra de verdad, que es lo que hace seguro un flujo de un toque.
  await page.getByRole("button", { name: /Deshacer/ }).click();
  await expect(page.getByRole("button", { name: "Guardar gasto" })).toBeVisible();
  await tab.reload();
  await expect(tab.getByText("Coto Bulnes")).toHaveCount(0);
  await tab.close();

  expect(errors, `errores de consola: ${errors.join(" | ")}`).toHaveLength(0);
});

const RECIBO_TEXTO = `Comprobante de transferencia
Importe: $ 45.000,00
Destinatario: MARIA LOPEZ
CUIT/CUIL: 27-12345678-9
CBU: 0170099220000067797370
Fecha y hora: 20/08/2026 14:32`;

/**
 * El lector de comprobantes. Ninguno de estos tests crea un gasto: el lector
 * llena el formulario y nada más, que es justamente el invariante que se está
 * comprobando.
 */
test("pegar un comprobante llena el formulario", async ({ page }) => {
  await page.goto("/registrar");
  await expect(page.getByRole("heading", { name: "Registrar gasto" })).toBeVisible();

  await page.getByRole("button", { name: "Pegar comprobante" }).click();
  await page.getByPlaceholder(/Transferencia enviada/).fill(RECIBO_TEXTO);
  await page.getByRole("button", { name: "Leer comprobante" }).click();

  await expect(page.getByLabel("Monto")).toHaveValue("45.000,00");
  await expect(page.getByPlaceholder("Dónde fue")).toHaveValue("MARIA LOPEZ");
  await expect(page.getByText("20 de agosto")).toBeVisible();
  // El CBU de 22 dígitos y el CUIT están en el mismo texto y son más grandes
  // que el importe: que no los agarre es la mitad del trabajo del parser.
  await expect(page.getByText(/Leímos/)).toBeVisible();
});

test("un comprobante ilegible no rompe la pantalla", async ({ page }) => {
  await page.goto("/registrar");
  await page.getByRole("button", { name: "Pegar comprobante" }).click();
  await page.getByPlaceholder(/Transferencia enviada/).fill("hola que tal");
  await page.getByRole("button", { name: "Leer comprobante" }).click();

  // Aviso legible y formulario usable. El backend contesta 200 a propósito: el
  // resultado correcto de "no pude leer esto" es un formulario en blanco, no
  // una pantalla de error.
  await expect(page.getByText(/No encontramos el importe/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar gasto" })).toBeVisible();
  await expect(page.getByLabel("Monto")).toHaveValue("");
});

test("subir un PDF de comprobante llena el formulario", async ({ page, browser }) => {
  // Un PDF con capa de texto real, que es lo que emiten los bancos y
  // billeteras argentinas. Por eso este camino no necesita OCR.
  const pdfPath = path.join(os.tmpdir(), `comprobante-${Date.now()}.pdf`);
  const ctx = await browser.newContext();
  const tmp = await ctx.newPage();
  await tmp.setContent(`<html><body style="font-family:sans-serif;padding:40px">
    <h2>Comprobante de transferencia</h2>
    <p>Importe: $ 78.900,25</p>
    <p>Destinatario: FERRETERIA EL TORNILLO</p>
    <p>CUIT/CUIL: 30-71234567-4</p>
    <p>CBU: 0170099220000067797370</p>
    <p>Fecha: 18/08/2026</p>
    <p>Número de operación: 99887766554433</p>
  </body></html>`);
  fs.writeFileSync(pdfPath, await tmp.pdf({ format: "A4" }));
  await ctx.close();

  try {
    await page.goto("/registrar");
    await expect(page.getByRole("heading", { name: "Registrar gasto" })).toBeVisible();
    await page.setInputFiles('input[type="file"]', pdfPath);

    await expect(page.getByLabel("Monto")).toHaveValue("78.900,25");
    await expect(page.getByPlaceholder("Dónde fue")).toHaveValue("FERRETERIA EL TORNILLO");
    await expect(page.getByText("18 de agosto")).toBeVisible();
  } finally {
    fs.unlinkSync(pdfPath);
  }
});
