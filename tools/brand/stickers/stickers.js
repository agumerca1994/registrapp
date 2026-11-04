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
  if (reaction === "escucha") { listening(svg); window.sceneReady = true; return; }
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

  // La t con auriculares: ojos cerrados, sonríe, cabecea al ritmo y le salen notas. No es una reacción del
  // avatar sino un estado (el bot está escuchando un audio), y dura un loop justo: 4 cabeceos en 2,4 s.
  function listening(svg) {
    const INK = "#5B4FE9", NS = "http://www.w3.org/2000/svg", BEAT = 600, LOOP = 2400;
    const q = (sel) => svg.querySelector(sel);
    const add = (parent, html, first) => {
      const g = document.createElementNS(NS, "g");
      g.innerHTML = html;
      if (first) parent.insertBefore(g, parent.firstChild); else parent.appendChild(g);
      return g;
    };
    svg.setAttribute("class", "tav tav--awake");
    q(".tav-eyes").style.display = "none";
    for (const el of [q(".tav-face"), q(".tav-happy")]) Object.assign(el.style, { opacity: "1", display: "inline", transform: "none" });
    for (const el of svg.querySelectorAll(".mouth > g")) el.style.display = "none";
    Object.assign(q(".tav-m-smile").style, { display: "inline", opacity: "1", transform: "none" });
    const anim = q(".tav-anim");
    anim.style.animation = "none";
    // La vincha pasa por detrás de la letra y del copete; los auriculares, por delante del travesaño.
    add(anim, `<path d="M52 82 C50 6 150 6 148 82" fill="none" stroke="${INK}" stroke-width="7.5" stroke-linecap="round"/>`, true);
    add(anim, [[43, 62], [139, 62]].map(([x, y]) =>
      `<rect x="${x}" y="${y}" width="18" height="38" rx="9" fill="${INK}" stroke="#ffffff" stroke-width="2.5"/>`).join(""));
    // Las notas salen como los tildes de "cargado": cuatro lugares, de a una, creciendo mientras se apagan. Los
    // lugares no son SPOTS porque ahí pisaban la vincha y los auriculares. Ciclo de 1,2 s: entran justo dos en el loop.
    const NOTE = `<ellipse cx="0" cy="0" rx="5.4" ry="4.2" transform="rotate(-20)" fill="${INK}"/>` +
      `<path d="M4.6 -1 V-20 C8 -18 12 -16 12 -10" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
    const notes = [[24, 24], [176, 34], [32, 140], [172, 136]].map(([x, y], i) => ({ el: add(svg, NOTE), x: x - 4, y: y + 8, at: i * 300 }));
    const SPARK = 1200;
    const ease = (k) => 0.5 - 0.5 * Math.cos(k * 2 * Math.PI);
    window.renderAt = (t) => {
      const beat = ease((t % BEAT) / BEAT), side = Math.floor(t / BEAT) % 2 ? 1 : -1;
      anim.setAttribute("transform", `rotate(${side * beat * 3.5} 95 168) translate(0 ${beat * 3})`);
      for (const n of notes) {
        const k = ((t - n.at + LOOP) % SPARK) / SPARK;
        n.el.setAttribute("transform", `translate(${n.x + 4} ${n.y - 8}) scale(${(0.5 + k * 0.7).toFixed(3)}) translate(-4 8)`);
        n.el.setAttribute("opacity", Math.min(1, k / 0.2, (1 - k) / 0.35).toFixed(2));
      }
    };
  }
})();
