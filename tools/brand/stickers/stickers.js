// Escena para los stickers del bot: la t sola, 512×512, fondo transparente. #sticker-<reacción>.
(function () {
  const m = location.hash.match(/^#sticker-(\w+)$/);
  if (!m) return;
  const reaction = m[1];
  document.querySelector(".wrap").style.display = "none";
  for (const el of [document.documentElement, document.body]) {
    Object.assign(el.style, { background: "transparent", margin: "0", padding: "0", overflow: "hidden" });
  }
  const root = document.createElement("div");
  Object.assign(root.style, { position: "fixed", left: "0", top: "0", width: "512px", height: "512px",
    display: "flex", alignItems: "center", justifyContent: "center", background: "transparent" });
  root.id = "sticker";
  document.body.appendChild(root);
  const host = document.createElement("div");
  host.style.transform = "translateX(5.5%)"; // centrada por lo que se dibuja
  root.appendChild(host);
  // Violeta de la marca, huecos blancos: se lee en el chat claro y en el oscuro.
  const av = makeAvatar(host, { size: 440, ink: "#5B4FE9", hole: "#ffffff", ok: "#22b55a", alert: "#e5383b", mouth: "arco" });
  avatars.splice(avatars.indexOf(av), 1);
  // Estado exacto en el instante t (ms), sin timers: la clase de la reacción, el llenado de color y cada
  // animación CSS en su punto. Así cada cuadro sale igual, por más que la captura tarde.
  const svg = av.svg, fillRect = svg.querySelector(".fillrect");
  const fillPaths = svg.querySelectorAll(".fillcopy path");
  const START = 120, DUR = DURATION[reaction];
  const color = reaction === "alerta" ? "#e5383b" : "#22b55a";
  fillPaths.forEach((p) => p.setAttribute("fill", color));
  const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const born = new WeakMap();
  let lastCls = "";
  window.renderAt = (t) => {
    const on = t >= START && t < START + DUR;
    const cls = on ? `tav tav--${reaction}` : "tav tav--rest";
    if (cls !== lastCls) { svg.setAttribute("class", cls); lastCls = cls; }
    let level = 0;
    if (reaction === "gasto" || reaction === "alerta") {
      level = t < START + DUR ? ease(clamp((t - START) / 750)) : 1 - ease(clamp((t - START - DUR) / 650));
    }
    const top = 182 - level * 205;
    fillRect.setAttribute("y", top); fillRect.setAttribute("height", Math.max(0, 184 - top));
    document.getAnimations().forEach((a) => {
      if (!born.has(a)) { born.set(a, t); a.pause(); }
      a.currentTime = t - born.get(a);
    });
  };
  window.sceneReady = true;
})();
