// Genera los stickers animados del bot (frontend/public/brand/tood/stickers/) a partir del avatar del lienzo.
// Uso, desde la raíz del repo: python3 tools/brand/lienzo/build.py && node tools/brand/stickers/build.cjs [reacción]
// Necesita img2webp (brew install webp). Cada cuadro se dibuja en un instante exacto (renderAt en stickers.js):
// sin timers ni relojes, la animación sale pareja aunque la captura tarde.
const path = require("path");
const ROOT = path.resolve(__dirname, "../../..");
const { chromium } = require(path.join(ROOT, "frontend/node_modules/playwright"));
const fs = require("fs"), { execFileSync } = require("child_process");
const D = path.join(require("os").tmpdir(), "tood-stickers"), FPS = 25, STEP = 1000 / FPS;
// Lo que dura cada loop: la reacción, la vuelta al violeta (0,65 s) y una pausa corta antes de repetir.
const TOTALS = { gasto: 2850, meta: 2950, alerta: 2850, duda: 2300, escucha: 2400 };
// La reacción del lienzo → el nombre del sticker en el bot.
const STICKERS = { gasto: "cargado", meta: "ingreso", alerta: "error", duda: "duda", escucha: "escuchando" };
const ONLY = process.argv[2];
// Con los auriculares y las notas se pasaba de los 500 KB.
const QUALITY = { escucha: 38 };
(async () => {
  fs.mkdirSync(D, { recursive: true });
  // La escena es el lienzo de la marca más stickers.js.
  fs.writeFileSync(`${D}/stickers.html`, fs.readFileSync(path.join(ROOT, "tools/brand/lienzo/tood-lienzo.html"), "utf8")
    + `\n<script src="file://${path.join(__dirname, "stickers.js")}"></script>\n`);
  const b = await chromium.launch();
  for (const [reaction, name] of Object.entries(STICKERS)) {
    if (ONLY && ONLY !== reaction) continue;
    const p = await b.newPage({ viewport: { width: 512, height: 512 } });
    await p.goto(`file://${D}/stickers.html#sticker-${reaction}`);
    await p.waitForFunction(() => window.sceneReady);
    await p.evaluate(() => document.fonts.ready);
    const dir = `${D}/st-${name}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
    const files = [];
    for (let t = 0, i = 0; t < TOTALS[reaction]; t += STEP, i++) {
      await p.evaluate((ms) => window.renderAt(ms), t);
      const f = `${dir}/f${String(i).padStart(3, "0")}.png`;
      await p.locator("#sticker").screenshot({ path: f, omitBackground: true });
      files.push(f);
    }
    // WhatsApp pide 512×512 y menos de 500 KB para un sticker animado.
    const out = path.join(ROOT, `frontend/public/brand/tood/stickers/sticker-${name}.webp`);
    execFileSync("img2webp", ["-loop", "0", "-lossy", "-q", String(QUALITY[reaction] || 60), "-m", "6", "-d", String(Math.round(STEP)), ...files, "-o", out]);
    console.log(name, files.length, "cuadros", Math.round(fs.statSync(out).size / 1024) + " KB");
    await p.close();
  }
  await b.close();
})();
