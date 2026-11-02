"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import {
  ArrowRight, Bell, Bookmark, BookOpen, ChevronDown, ChevronLeft, ChevronUp, Copy, Lock, Menu, MoreVertical, Pause, Play,
  PenLine, Printer, RotateCw, Search, Share, Plus, Star, X,
} from "lucide-react";
import { ToodAvatar, type ToodReaction } from "@/components/brand/ToodAvatar";
import { ToodLogo } from "@/components/brand/ToodLogo";
import { BRAND_FIELD } from "@/lib/brand/tood-cara";
import { appHref } from "@/lib/site";
import { BrandIcon, type BrandIconName } from "./BrandIcon";
import { PhoneFrame } from "./Frames";

/**
 * Cómo instalar tood, animado: la t recorre el celular y toca lo que hay que tocar. Es la misma historia que los
 * reels de instagram (14 y 15), rehecha para la web: en vivo, en vez de un video vertical, se puede pausar y saltar a
 * un paso, y la lista de pasos es texto de verdad.
 *
 * Las pantallas del navegador copian las reales. Las de iPhone salen de Safari en iOS 27 (el simulador); si Apple las
 * vuelve a mover, se corrigen acá y en STEPS. Con movimiento reducido no arranca sola: cada paso muestra su pantalla.
 */

type Platform = "iphone" | "android";
type Scene = "browser" | "menu" | "share" | "shareFull" | "add" | "dialog" | "home" | "splash" | "app";

/** `to` es el `data-tap` del elemento al que va la t; sin `to`, se queda en `at` (en % de la pantalla). */
type Beat = {
  scene: Scene; step: number; ms: number;
  to?: string; tap?: boolean; at?: [number, number]; hideT?: boolean; reaction?: ToodReaction;
};

function InlineBrand({ name, children }: { name: BrandIconName; children: ReactNode }) {
  return (
    <strong className="inline-flex items-center gap-1 align-bottom">
      <BrandIcon name={name} className="h-[1.1em] w-[1.1em]" />{children}
    </strong>
  );
}

const STEPS: Record<Platform, ReactNode[]> = {
  iphone: [
    <>Abrí <strong>app.tood.com.ar</strong> en <InlineBrand name="safari">Safari</InlineBrand>.</>,
    <>Tocá el menú <strong>☰</strong>, al lado de la dirección, y elegí <strong>Compartir</strong>.</>,
    <>Tocá <strong>Ver más</strong> y después <strong>Agregar a Inicio</strong>.</>,
    <>Dejá prendido <strong>Abrir como app web</strong> y tocá <strong>Agregar</strong>.</>,
    <>Listo: abrila desde el ícono de <strong>tood</strong>.</>,
  ],
  android: [
    <>Abrí <strong>app.tood.com.ar</strong> en <InlineBrand name="googlechrome">Chrome</InlineBrand>.</>,
    <>Tocá el menú <strong>⋮</strong>, arriba a la derecha.</>,
    <>Elegí <strong>Agregar a la pantalla principal</strong>.</>,
    <>Confirmá con <strong>Instalar</strong>.</>,
    <>Listo: abrila desde el ícono de <strong>tood</strong>.</>,
  ],
};

const NOTES: Record<Platform, ReactNode> = {
  iphone: <>¿Tu Safari se ve distinto? En versiones anteriores de iOS, <strong>Compartir</strong> es el botón de la barra
    de abajo (el cuadrado con la flecha) y la opción se llama <strong>Agregar a pantalla de inicio</strong>.</>,
  android: <>¿No aparece esa opción? En algunos teléfonos se llama <strong>Instalar app</strong>.</>,
};

const REST: [number, number] = [76, 62];

const BEATS: Record<Platform, Beat[]> = {
  iphone: [
    { scene: "browser", step: 0, ms: 2400, at: REST, reaction: "toque" },
    { scene: "browser", step: 1, ms: 1700, to: "bar-menu", tap: true },
    { scene: "menu", step: 1, ms: 1800, to: "compartir", tap: true },
    { scene: "share", step: 2, ms: 1800, to: "ver-mas", tap: true },
    { scene: "shareFull", step: 2, ms: 1900, to: "agregar-inicio", tap: true },
    { scene: "add", step: 3, ms: 2300, to: "agregar", tap: true },
    { scene: "home", step: 4, ms: 1300, at: REST, reaction: "toque" },
    { scene: "home", step: 4, ms: 1500, to: "icono", tap: true },
    { scene: "splash", step: 4, ms: 1500, hideT: true },
    { scene: "app", step: 4, ms: 3400, at: [50, 72], reaction: "gasto" },
  ],
  android: [
    { scene: "browser", step: 0, ms: 2400, at: REST, reaction: "toque" },
    { scene: "browser", step: 1, ms: 1700, to: "bar-menu", tap: true },
    { scene: "menu", step: 2, ms: 2000, to: "agregar-inicio", tap: true },
    { scene: "dialog", step: 3, ms: 2200, to: "agregar", tap: true },
    { scene: "home", step: 4, ms: 1300, at: REST, reaction: "toque" },
    { scene: "home", step: 4, ms: 1500, to: "icono", tap: true },
    { scene: "splash", step: 4, ms: 1500, hideT: true },
    { scene: "app", step: 4, ms: 3400, at: [50, 72], reaction: "gasto" },
  ],
};

const PLATFORMS: { key: Platform; label: string; browser: string; icon: BrandIconName }[] = [
  { key: "iphone", label: "iPhone", browser: "Safari", icon: "apple" },
  { key: "android", label: "Android", browser: "Chrome", icon: "android" },
];

const APP_COLORS = ["#fca5a5", "#fcd34d", "#86efac", "#93c5fd", "#c4b5fd", "#f9a8d4", "#5eead4", "#fdba74", "#a5b4fc", "#bef264", "#67e8f9", "#fda4af"];

const ICON = "h-[5cqw] w-[5cqw] shrink-0";

export default function InstallDemo({ className = "" }: { className?: string }) {
  const [platform, setPlatform] = useState<Platform>("iphone");
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pressed, setPressed] = useState<string | null>(null);
  const [tapCount, setTapCount] = useState(0);
  const [pos, setPos] = useState({ x: REST[0], y: REST[1], edge: REST[1], below: true });
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const hop = useRef<HTMLDivElement>(null);
  const ripple = useRef<HTMLSpanElement>(null);

  const beats = BEATS[platform];
  const beat = beats[index] ?? beats[0];
  const animate = useRef(false);

  useEffect(() => {
    // Quien ya está en el celular ve primero el suyo. Con movimiento reducido, nada arranca solo.
    if (/Android/i.test(navigator.userAgent)) setPlatform("android");
    animate.current = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setPlaying(animate.current);
  }, []);

  // Fuera de la pantalla no corre: al llegar a la sección arranca desde donde iba, no por el final.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    setPressed(null);
    if (!playing || !visible) return;
    const timers: number[] = [];
    if (beat.tap) timers.push(window.setTimeout(() => {
      setPressed(beat.to ?? null);
      setTapCount((n) => n + 1);
    }, beat.ms * 0.68));
    timers.push(window.setTimeout(() => setIndex((i) => (i + 1) % beats.length), beat.ms));
    return () => timers.forEach(clearTimeout);
  }, [beat, beats.length, playing, visible]);

  // Dónde tiene que estar la t: se mide el elemento (en % de la pantalla, así sobrevive a un cambio de tamaño).
  // offsetLeft/offsetTop ignoran transformaciones: una hoja que todavía está subiendo da su lugar final.
  useEffect(() => {
    const box = stage.current;
    if (!box) return;
    const measure = () => {
      if (!beat.to) {
        const [x, y] = beat.at ?? REST;
        setPos({ x, y, edge: y, below: true });
        return;
      }
      const el = box.querySelector<HTMLElement>(`[data-tap="${beat.to}"]`);
      if (!el) return;
      let left = el.offsetWidth / 2, top = el.offsetHeight / 2;
      for (let n: HTMLElement | null = el; n && n !== box; n = n.offsetParent as HTMLElement | null) {
        left += n.offsetLeft;
        top += n.offsetTop;
      }
      const x = (left / box.offsetWidth) * 100, y = (top / box.offsetHeight) * 100;
      // La t se para justo debajo de lo que toca, o arriba si no hay lugar: encima taparía lo que hay que leer.
      const half = (el.offsetHeight / 2 / box.offsetHeight) * 100, below = y < 74;
      setPos({ x, y, edge: below ? y + half : y - half, below });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [beat, platform]);

  // El salto y el toque van con la Web Animations API: la distancia depende del tamaño del celular.
  useEffect(() => {
    if (!animate.current || !playing || !beat.to) return;
    const h = (stage.current?.offsetWidth ?? 300) * 0.12;
    hop.current?.animate(
      [{ transform: "translateY(0)" }, { transform: `translateY(${-h}px)` }, { transform: "translateY(0)" }],
      { duration: 620, easing: "ease-in-out" },
    );
  }, [beat, playing]);
  useEffect(() => {
    if (!tapCount) return;
    ripple.current?.animate(
      [{ transform: "translate(-50%,-50%) scale(.3)", opacity: 0.8 }, { transform: "translate(-50%,-50%) scale(1.5)", opacity: 0 }],
      { duration: 550, easing: "ease-out" },
    );
  }, [tapCount]);

  const choosePlatform = useCallback((p: Platform) => {
    setPlatform(p);
    setIndex(0);
  }, []);
  const chooseStep = (step: number) => setIndex(Math.max(0, beats.findIndex((b) => b.step === step)));

  const reaction: ToodReaction | null = pressed ? "toque" : beat.reaction ?? null;
  const browserName = PLATFORMS.find((p) => p.key === platform)!.browser;

  return (
    <div ref={root} className={`grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-8 md:gap-12 items-center ${className}`}>
      <div className="min-w-0 md:order-2">
        <div role="group" aria-label="Elegí tu celular" className="flex gap-2">
          {PLATFORMS.map(({ key, label, icon }) => (
            <button key={key} type="button" aria-pressed={platform === key} onClick={() => choosePlatform(key)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-5 font-semibold transition-colors ${platform === key
                ? "border-ink bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:border-ink"}`}>
              <BrandIcon name={icon} />{label}
            </button>
          ))}
        </div>

        <ol className="mt-5 space-y-2">
          {STEPS[platform].map((text, i) => (
            <li key={i}>
              <button type="button" onClick={() => chooseStep(i)} aria-current={beat.step === i ? "step" : undefined}
                className={`w-full flex items-start gap-3 rounded-2xl border-2 p-3 text-left transition-colors ${beat.step === i
                  ? "border-ink bg-card"
                  : "border-transparent hover:bg-card"}`}>
                <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display font-bold text-sm ${beat.step === i
                  ? "bg-primary text-primary-foreground"
                  : "bg-accent text-foreground"}`}>
                  {i + 1}
                </span>
                <span className="pt-0.5">{text}</span>
              </button>
            </li>
          ))}
        </ol>

        <p className="mt-4 text-sm text-muted-foreground">{NOTES[platform]}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Si el link se te abrió adentro de WhatsApp o Instagram, primero pasalo a {browserName}: desde ahí adentro no se puede instalar.
        </p>
        <a href={appHref("/login")}
          className="mt-5 inline-flex items-center gap-2 rounded-full border-2 border-ink bg-primary px-5 py-3 font-semibold text-primary-foreground shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
          Abrir app.tood.com.ar <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>

      <div className="min-w-0 md:order-1">
        <div className="mx-auto w-[72%] max-w-[260px]">
          <PhoneFrame>
            <div ref={stage} aria-hidden="true"
              className="relative aspect-[390/844] overflow-hidden bg-background text-[3.5cqw] leading-tight text-[#111]">
              {platform === "iphone"
                ? <IphoneScreens scene={beat.scene} pressed={pressed} />
                : <AndroidScreens scene={beat.scene} pressed={pressed} />}

              <span ref={ripple} className="pointer-events-none absolute z-30 h-[16cqw] w-[16cqw] rounded-full border-[1cqw] border-primary opacity-0"
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }} />
              <div className={`pointer-events-none absolute z-40 h-[20cqw] w-[20cqw] transition-[left,top,opacity] duration-700 ease-in-out motion-reduce:transition-none ${beat.hideT ? "opacity-0" : "opacity-100"}`}
                style={{
                  left: `${Math.min(88, Math.max(12, pos.x))}%`, top: `${pos.edge}%`,
                  transform: pos.below ? "translate(-50%, 0)" : "translate(-50%, -100%)",
                }}>
                <div ref={hop} className="[filter:drop-shadow(0_0_1px_#fff)_drop-shadow(0_0_1px_#fff)]">
                  <ToodAvatar size="100%" reaction={reaction} reactionKey={`${index}-${tapCount}`} title="" />
                </div>
              </div>
            </div>
          </PhoneFrame>
        </div>

        {/* En el celular la lista queda lejos del dibujo: el paso actual se repite abajo, y se reserva su lugar para
            que la página no salte al cambiar de paso. Un lector de pantalla ya tiene la lista. */}
        <p aria-hidden="true" className="md:hidden mt-4 min-h-[4.5rem] text-center">
          <span className="font-semibold text-primary">Paso {beat.step + 1}. </span>{STEPS[platform][beat.step]}
        </p>
        <div className="mt-2 md:mt-4 flex justify-center">
          <button type="button" onClick={() => { animate.current = true; setPlaying((p) => !p); }}
            className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium text-muted-foreground hover:text-foreground">
            {playing
              ? <><Pause className="h-4 w-4" aria-hidden="true" /> Pausar la animación</>
              : <><Play className="h-4 w-4" aria-hidden="true" /> Ver la animación</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function Layer({ show, z = 0, children, className = "" }: { show: boolean; z?: number; children?: ReactNode; className?: string }) {
  return (
    <div style={{ zIndex: z }}
      className={`absolute inset-0 transition-opacity duration-300 motion-reduce:transition-none ${show ? "opacity-100" : "opacity-0"} ${className}`}>
      {children}
    </div>
  );
}

/** Una hoja que sube desde abajo, con el fondo apagado. */
function Sheet({ show, z, height, children }: { show: boolean; z: number; height: string; children: ReactNode }) {
  return (
    <Layer show={show} z={z} className="bg-black/25">
      <div style={{ height }}
        className={`absolute inset-x-0 bottom-0 overflow-hidden rounded-t-[7cqw] bg-[#f2f2f7] p-[4cqw] transition-transform duration-[450ms] ease-out motion-reduce:transition-none ${show ? "translate-y-0" : "translate-y-full"}`}>
        {children}
      </div>
    </Layer>
  );
}

function Row({ id, pressed, icon, children }: { id?: string; pressed: string | null; icon?: ReactNode; children: ReactNode }) {
  return (
    <div data-tap={id} className={`flex items-center gap-[3cqw] px-[4cqw] py-[3cqw] whitespace-nowrap transition-colors ${id && pressed === id ? "bg-primary/20" : ""}`}>
      {icon}{children}
    </div>
  );
}

function StatusBar({ island, light = false }: { island: boolean; light?: boolean }) {
  return (
    <div className={`absolute inset-x-0 top-0 z-[1] flex h-[11cqw] items-center justify-between px-[8cqw] text-[3.4cqw] font-semibold ${light ? "text-white" : "text-[#111]"}`}>
      <span>9:41</span>
      {island
        ? <span className="absolute left-1/2 top-[2cqw] h-[7.5cqw] w-[27cqw] -translate-x-1/2 rounded-full bg-ink" />
        : <span className="absolute left-1/2 top-[3cqw] h-[4.5cqw] w-[4.5cqw] -translate-x-1/2 rounded-full bg-ink" />}
      <span className="h-[2.6cqw] w-[5.2cqw] rounded-[0.8cqw] border-[0.4cqw] border-current" />
    </div>
  );
}

function Capture({ top = "11cqw" }: { top?: string }) {
  return (
    <div className="absolute inset-x-0 bottom-0" style={{ top }}>
      <Image src="/home/celular-hogar.jpg" alt="" fill sizes="300px" className="object-cover object-top" />
    </div>
  );
}

function TileRow({ names }: { names?: string[] }) {
  return (
    <div className="mt-[4cqw] grid grid-cols-4 gap-[2cqw] border-t border-black/10 pt-[3.5cqw] text-center text-[2.8cqw]">
      {APP_COLORS.slice(0, 4).map((c, i) => (
        <div key={c}>
          <div className="mx-auto h-[12cqw] w-[12cqw] rounded-[3cqw]" style={{ background: c }} />
          {names && <div className="mt-[1cqw]">{names[i]}</div>}
        </div>
      ))}
    </div>
  );
}

function SheetHeader() {
  return (
    <div className="flex items-center gap-[3cqw]">
      <Image src="/brand/tood/tood-icono-192.png" alt="" width={48} height={48} className="h-[12cqw] w-[12cqw] rounded-[3cqw]" />
      <div>
        <div className="font-semibold">tood</div>
        <div className="text-[3cqw] text-[#8e8e93]">app.tood.com.ar</div>
      </div>
    </div>
  );
}

function ActionTiles({ pressed, open }: { pressed: string | null; open: boolean }) {
  const tiles = [
    { icon: <Copy className={ICON} />, label: "Copiar" },
    { icon: <Bookmark className={ICON} />, label: "Marcadores" },
    { icon: <BookOpen className={ICON} />, label: "Lecturas" },
  ];
  const id = open ? undefined : "ver-mas";
  return (
    <div className="mt-[4cqw] grid grid-cols-4 gap-[2cqw] text-center text-[2.8cqw]">
      {tiles.map(({ icon, label }) => (
        <div key={label}>
          <div className="mx-auto flex h-[12cqw] w-[12cqw] items-center justify-center rounded-full bg-black/5">{icon}</div>
          <div className="mt-[1cqw]">{label}</div>
        </div>
      ))}
      <div data-tap={id}>
        <div className={`mx-auto flex h-[12cqw] w-[12cqw] items-center justify-center rounded-full transition-colors ${id && pressed === id ? "bg-primary/30" : "bg-black/5"}`}>
          {open ? <ChevronUp className={ICON} /> : <ChevronDown className={ICON} />}
        </div>
        <div className="mt-[1cqw]">{open ? "Ver menos" : "Ver más"}</div>
      </div>
    </div>
  );
}

function HomeScreen({ scene, island, pressed }: { scene: Scene; island: boolean; pressed: string | null }) {
  const show = scene === "home";
  return (
    <Layer show={show} z={7} className="bg-gradient-to-b from-[#c9c3f5] to-[#efedfc]">
      <StatusBar island={island} />
      <div className="absolute inset-x-[7cqw] top-[18cqw] grid grid-cols-4 gap-x-[6cqw] gap-y-[8cqw]">
        {APP_COLORS.map((c) => <div key={c} className="aspect-square rounded-[3.5cqw]" style={{ background: c }} />)}
        {/* El ícono nuevo aparece con un rebote al llegar a esta pantalla. */}
        <div data-tap="icono" className={`aspect-square transition-transform duration-500 ease-[cubic-bezier(.34,1.56,.64,1)] motion-reduce:transition-none ${show ? "scale-100 delay-300" : "scale-0"} ${pressed === "icono" ? "!scale-90" : ""}`}>
          <Image src="/brand/tood/tood-icono-192.png" alt="" width={64} height={64} className="h-full w-full rounded-[3.5cqw]" />
        </div>
      </div>
      <div className="absolute inset-x-[5cqw] bottom-[5cqw] grid grid-cols-4 gap-x-[6cqw] rounded-[7cqw] bg-white/40 p-[3cqw]">
        {APP_COLORS.slice(4, 8).map((c) => <div key={c} className="aspect-square rounded-[3.5cqw]" style={{ background: c }} />)}
      </div>
    </Layer>
  );
}

function SplashAndApp({ scene, island }: { scene: Scene; island: boolean }) {
  return (
    <>
      <Layer show={scene === "app"} z={8} className="bg-background">
        <StatusBar island={island} />
        <Capture />
      </Layer>
      <Layer show={scene === "splash"} z={9}>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-[5cqw] text-white" style={{ background: BRAND_FIELD }}>
          <ToodLogo className="h-[11cqw] w-auto" />
          <div className="h-[30cqw] w-[30cqw]">
            <ToodAvatar size="100%" ink="#ffffff" holeColor={BRAND_FIELD} awake title="" />
          </div>
        </div>
      </Layer>
    </>
  );
}

function IphoneScreens({ scene, pressed }: { scene: Scene; pressed: string | null }) {
  const inBrowser = ["browser", "menu", "share", "shareFull", "add"].includes(scene);
  return (
    <div className="absolute inset-0">
      <Layer show={inBrowser} z={1} className="bg-card">
        <StatusBar island />
        <Capture />
        {/* Safari en iOS 27: atrás, la cápsula con el menú y la dirección, y las pestañas. Ya no hay un botón Compartir. */}
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-[2cqw] bg-[#f2f2f7] px-[3cqw] pb-[4cqw] pt-[2.5cqw]">
          <div className="flex h-[11cqw] w-[11cqw] items-center justify-center rounded-full bg-white/90 text-[#b0b0b5] shadow"><ChevronLeft className={ICON} /></div>
          <div className="flex h-[11cqw] min-w-0 flex-1 items-center gap-[2cqw] rounded-full bg-white/95 px-[3cqw] shadow">
            <span data-tap="bar-menu" className={`rounded-full p-[0.5cqw] transition-colors ${pressed === "bar-menu" ? "bg-primary/30" : ""}`}><Menu className={ICON} /></span>
            <span className="flex-1 truncate text-center">app.tood.com.ar</span>
            <RotateCw className="h-[4cqw] w-[4cqw] shrink-0" />
          </div>
          <div className="flex h-[11cqw] w-[11cqw] items-center justify-center rounded-full bg-white/90 shadow"><Copy className={ICON} /></div>
        </div>
      </Layer>

      <Layer show={scene === "menu"} z={2} className="bg-black/10">
        <div className="absolute bottom-[17cqw] left-[12cqw] w-[66cqw] overflow-hidden rounded-[6cqw] bg-white/95 py-[1.5cqw] shadow-lg">
          <Row id="compartir" pressed={pressed} icon={<Share className={ICON} />}>Compartir</Row>
          <Row pressed={pressed} icon={<Bookmark className={ICON} />}>Agregar a Marcadores</Row>
          <Row pressed={pressed} icon={<Search className={ICON} />}>Buscar en la página</Row>
          <Row pressed={pressed} icon={<Bell className={ICON} />}>Notificarme</Row>
        </div>
      </Layer>

      <Sheet show={scene === "share"} z={3} height="50%">
        <SheetHeader />
        <TileRow names={["News", "Recordatorios", "Safari", "Más"]} />
        <ActionTiles pressed={pressed} open={false} />
      </Sheet>

      <Sheet show={scene === "shareFull"} z={4} height="88%">
        <SheetHeader />
        <TileRow names={["News", "Recordatorios", "Safari", "Más"]} />
        <ActionTiles pressed={pressed} open />
        <div className="mt-[4cqw] divide-y divide-black/10 overflow-hidden rounded-[4cqw] bg-black/5">
          <Row pressed={pressed} icon={<Star className={ICON} />}>Agregar a Favoritos</Row>
          <Row pressed={pressed} icon={<Search className={ICON} />}>Buscar en la página</Row>
          <Row id="agregar-inicio" pressed={pressed} icon={<Plus className={ICON} />}>Agregar a Inicio</Row>
        </div>
        <div className="mt-[3cqw] divide-y divide-black/10 overflow-hidden rounded-[4cqw] bg-black/5">
          <Row pressed={pressed} icon={<PenLine className={ICON} />}>Marcado</Row>
          <Row pressed={pressed} icon={<Printer className={ICON} />}>Imprimir</Row>
        </div>
      </Sheet>

      <Sheet show={scene === "add"} z={5} height="94%">
        <div className="flex items-center justify-between">
          <span className="flex h-[10cqw] w-[10cqw] items-center justify-center rounded-full bg-white shadow"><X className={ICON} /></span>
          <span className="font-semibold">Agregar a Inicio</span>
          <span data-tap="agregar" className={`rounded-full px-[3.5cqw] py-[2cqw] font-semibold text-white transition-colors ${pressed === "agregar" ? "bg-[#0058c4]" : "bg-[#007aff]"}`}>Agregar</span>
        </div>
        <div className="mt-[6cqw] flex items-center gap-[3cqw] rounded-[3cqw] bg-white p-[3cqw]">
          <Image src="/brand/tood/tood-icono-192.png" alt="" width={56} height={56} className="h-[14cqw] w-[14cqw] rounded-[3cqw]" />
          <div className="min-w-0">
            <div>tood</div>
            <div className="truncate text-[3cqw] text-[#8e8e93]">https://app.tood.com.ar/dashboard</div>
          </div>
        </div>
        <div className="mt-[6cqw] flex items-center justify-between rounded-[3cqw] bg-white p-[3cqw]">
          <span>Abrir como app web</span>
          <span className="relative h-[6cqw] w-[11cqw] rounded-full bg-[#34c759]">
            <span className="absolute right-[0.5cqw] top-[0.5cqw] h-[5cqw] w-[5cqw] rounded-full bg-white" />
          </span>
        </div>
      </Sheet>

      <HomeScreen scene={scene} island pressed={pressed} />
      <SplashAndApp scene={scene} island />
    </div>
  );
}

function AndroidScreens({ scene, pressed }: { scene: Scene; pressed: string | null }) {
  const inBrowser = ["browser", "menu", "dialog"].includes(scene);
  return (
    <div className="absolute inset-0">
      <Layer show={inBrowser} z={1} className="bg-card">
        <StatusBar island={false} />
        <div className="absolute inset-x-0 top-[11cqw] flex h-[14cqw] items-center gap-[2cqw] border-b border-black/10 bg-white px-[3cqw]">
          <div className="flex h-[9cqw] min-w-0 flex-1 items-center gap-[2cqw] rounded-full bg-[#f1f3f4] px-[3cqw] text-[#202124]">
            <Lock className="h-[3.5cqw] w-[3.5cqw] shrink-0" />
            <span className="truncate">app.tood.com.ar</span>
          </div>
          <span data-tap="bar-menu" className={`rounded-full p-[1cqw] text-[#5f6368] transition-colors ${pressed === "bar-menu" ? "bg-primary/30" : ""}`}><MoreVertical className={ICON} /></span>
        </div>
        <Capture top="25cqw" />
      </Layer>

      <Layer show={scene === "menu"} z={2}>
        <div className="absolute right-[2cqw] top-[12cqw] w-[72cqw] overflow-hidden rounded-[3cqw] bg-white py-[1.5cqw] text-[#202124] shadow-xl">
          {["Nueva pestaña", "Nueva pestaña de incógnito", "Historial", "Descargas", "Compartir…"].map((m) => (
            <Row key={m} pressed={pressed}>{m}</Row>
          ))}
          <Row id="agregar-inicio" pressed={pressed}>Agregar a la pantalla principal</Row>
          <Row pressed={pressed}>Configuración</Row>
        </div>
      </Layer>

      <Layer show={scene === "dialog"} z={3} className="bg-black/40">
        <div className="absolute inset-x-[6cqw] top-[62cqw] rounded-[6cqw] bg-white p-[5cqw] text-[#202124]">
          <div className="text-[4.6cqw] font-semibold">Instalar app</div>
          <div className="mt-[4cqw] flex items-center gap-[3cqw]">
            <Image src="/brand/tood/tood-icono-192.png" alt="" width={56} height={56} className="h-[14cqw] w-[14cqw] rounded-[3cqw]" />
            <div>
              <div className="font-semibold">tood</div>
              <div className="text-[3cqw] text-[#5f6368]">app.tood.com.ar</div>
            </div>
          </div>
          <div className="mt-[5cqw] flex justify-end gap-[3cqw] font-semibold text-[#1a73e8]">
            <span className="px-[2cqw] py-[2cqw]">Cancelar</span>
            <span data-tap="agregar" className={`rounded-full px-[4cqw] py-[2cqw] transition-colors ${pressed === "agregar" ? "bg-[#d2e3fc]" : ""}`}>Instalar</span>
          </div>
        </div>
      </Layer>

      <HomeScreen scene={scene} island={false} pressed={pressed} />
      <SplashAndApp scene={scene} island={false} />
    </div>
  );
}
