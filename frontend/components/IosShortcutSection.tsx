"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Download, Smartphone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { CopyButton } from "@/components/ui/copy-button";
import { isIOS } from "@/lib/push";

/**
 * Cómo cargar un gasto compartiendo el comprobante, en iPhone.
 *
 * En Android esto no hace falta: la app aparece sola en la hoja de compartir
 * (Web Share Target, declarado en el manifest). **En iOS eso no existe y no va
 * a existir** — Safari nunca implementó Web Share Target, los `shortcuts` del
 * manifest tampoco, y un Atajo no puede abrir una app instalada en la pantalla
 * de inicio porque todos los web clips comparten el mismo identificador. La
 * única vía es un Atajo que el usuario arma una vez.
 *
 * Dos decisiones de diseño que vale la pena no deshacer:
 *
 * - **El Atajo hace lo mínimo: extraer el texto y abrir una URL.** Todo el
 *   parseo vive del lado del servidor. Un error de parseo se arregla con un
 *   deploy; un error adentro de un Atajo ya instalado en el teléfono de otra
 *   persona no se arregla nunca.
 * - **El OCR lo hace iOS, gratis y en el dispositivo.** La acción "Extraer
 *   texto de la imagen" usa el framework Vision de Apple. Es la razón por la
 *   que en iPhone se puede leer una captura de un pago con QR y en Android
 *   todavía no.
 *
 * La sección sólo se muestra en iOS: en Android son instrucciones para un
 * teléfono que la persona no tiene.
 */
export function IosShortcutSection() {
  // `mounted` porque `isIOS()` mira `navigator`, que no existe en el servidor.
  // Sin esto, el HTML del servidor y el del cliente difieren y React tira un
  // error de hidratación. Es el mismo apaño que usan los gráficos.
  const [mounted, setMounted] = useState(false);
  const [manual, setManual] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setMounted(true);
    setOrigin(window.location.origin);
  }, []);

  if (!mounted || !isIOS()) return null;

  const url = `${origin}/registrar?source=shortcut&text=`;

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Smartphone className="w-4 h-4 text-primary shrink-0" />
        <h3 className="font-semibold text-foreground text-sm md:text-base">
          Compartir un comprobante desde el iPhone
        </h3>
        <Chip tone="violet" className="ml-auto shrink-0">iPhone</Chip>
      </div>

      <p className="text-sm text-muted-foreground">
        En iPhone, RegistrApp no puede aparecer sola en el menú de compartir —
        Safari no lo permite. Con un atajo que armás una vez, vas a poder sacarle
        una captura al comprobante, tocar <strong>Compartir</strong> y que el
        gasto se cargue casi solo. El texto lo lee el propio iPhone.
      </p>

      {/* El camino rápido. El archivo va firmado con `shortcuts sign --mode
          anyone` (ver scripts/build-ios-shortcut.py): sin firma, iOS 15+ exige
          activar "Permitir atajos no fiables" en Ajustes, que es un
          interruptor global y escondido que no se le puede pedir a nadie. */}
      <a
        href="/atajos/registrar-gasto.shortcut"
        download="Registrar gasto.shortcut"
        className="flex items-center justify-center gap-2 w-full rounded-full border-2 border-ink bg-primary text-primary-foreground px-4 py-3 text-sm font-medium shadow-chip transition-transform active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
      >
        <Download className="w-4 h-4" />
        Descargar el atajo
      </a>
      <p className="text-[11px] text-muted-foreground -mt-1">
        Se abre en la app <strong>Atajos</strong> y sólo tenés que tocar{" "}
        <strong>Añadir atajo</strong>. Si en vez de abrirse te lo guarda en{" "}
        <strong>Archivos</strong>, tocalo desde ahí.
      </p>

      <button
        type="button"
        onClick={() => setManual(v => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${manual ? "rotate-180" : ""}`} />
        {manual ? "Ocultar los pasos manuales" : "¿No te funcionó? Armalo a mano"}
      </button>

      {manual && (
        <div className="space-y-4 border-l-2 border-border pl-4">
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          1. Copiá esta dirección (la vas a necesitar en el paso 7)
        </p>
        <div className="flex gap-2 items-center">
          <code className="flex-1 min-w-0 text-[11px] bg-accent rounded-lg px-3 py-2 overflow-x-auto whitespace-nowrap">
            {url}
          </code>
          <CopyButton value={url} className="shrink-0" />
        </div>
      </div>

      <ol className="text-sm text-foreground space-y-2.5 list-decimal pl-5 marker:text-muted-foreground marker:font-medium">
        <li>Abrí la app <strong>Atajos</strong> (viene instalada en el iPhone).</li>
        <li>Tocá el <strong>+</strong> arriba a la derecha para crear un atajo nuevo.</li>
        <li>
          Tocá <strong>Añadir acción</strong>, escribí <em>extraer texto</em> en el
          buscador y elegí <strong>Extraer texto de la imagen</strong>.
        </li>
        <li>
          Tocá <strong>Añadir acción</strong> otra vez, buscá <em>codificar</em> y
          elegí <strong>Codificar URL</strong>. Fijate que diga
          <strong> Codificar</strong> y no <em>Descodificar</em>.
        </li>
        <li>
          Tocá <strong>Añadir acción</strong> una vez más, buscá <em>abrir URL</em> y
          elegí <strong>Abrir URL</strong>.
        </li>
        <li>
          Tocá el campo vacío de <strong>Abrir URL</strong> y pegá la dirección que
          copiaste arriba.
        </li>
        <li>
          Sin borrar nada, tocá justo al final de esa dirección y elegí la variable
          <strong> Texto codificado en URL</strong> (aparece sobre el teclado). Tiene
          que quedar la dirección y, pegada al final, la variable.
        </li>
        <li>
          Tocá el nombre del atajo arriba de todo → <strong>Cambiar nombre</strong> y
          poné <strong>Registrar gasto</strong>.
        </li>
        <li>
          Entrá a los <strong>detalles</strong> del atajo (el ícono de información
          <strong> ⓘ</strong> abajo, o la flechita al lado del nombre) y activá
          <strong> Mostrar en hoja de compartir</strong>.
        </li>
        <li>
          Ahí mismo, tocá <strong>Tipos de entrada</strong> y dejá tildado sólo
          <strong> Imágenes</strong>. Así el atajo aparece cuando compartís una
          captura y no te ensucia el menú el resto del tiempo.
        </li>
        <li>Guardá con <strong>Listo</strong>.</li>
      </ol>

        </div>
      )}

      <div className="rounded-lg bg-accent/60 px-3 py-2.5 space-y-1">
        <p className="text-xs font-medium text-foreground">Cómo se usa</p>
        <p className="text-xs text-muted-foreground">
          Sacale una captura al comprobante → <strong>Compartir</strong> →
          <strong> Registrar gasto</strong>. Se abre RegistrApp con el monto, la
          fecha y el comercio ya cargados. Revisás y guardás.
        </p>
      </div>

      <p className="text-[11px] text-muted-foreground">
        La primera vez te va a pedir iniciar sesión en Safari, aunque ya la tengas
        abierta en la app instalada: en iPhone son dos sesiones separadas y no hay
        forma de unirlas. Es una sola vez.
      </p>

      <p className="text-[11px] text-muted-foreground">
        ¿Tenés el comprobante en PDF? No hace falta el atajo: abrí RegistrApp,
        tocá el <strong>+</strong> del inicio y usá <strong>Subir PDF</strong>.
      </p>
    </Card>
  );
}
