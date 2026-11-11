"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, CheckCircle2, Smartphone, TriangleAlert } from "lucide-react";
import { FORM_SHEET_BODY, FormSheet } from "@/components/movimientos/FormSheet";
import { SettingsRow, SHEET_BLOCK, SHEET_NOTICE, SHEET_TEXT, SheetButton } from "@/components/settings/SettingsParts";
import api from "@/lib/api";
import { siteHref } from "@/lib/site";
import { enablePush, isIOS, pushConfigProblem, pushState, type PushState } from "@/lib/push";

/**
 * Activar las notificaciones push, desde Configuración.
 *
 * La razón de que esto sea una sección con texto y no un simple switch: cuando
 * los avisos no llegan, el motivo casi nunca es "no apretaste el botón". Puede
 * ser que el navegador no los soporte, que en iPhone la app no esté instalada
 * en la pantalla de inicio, o que el permiso se haya rechazado una vez y el
 * navegador ya no vuelva a preguntar. Cada uno tiene una salida distinta y
 * ninguna se adivina, así que la pantalla dice cuál es cada caso.
 *
 * El caso "denegado" es el que más incomoda y el único sin atajo: **no existe
 * una URL a la que un botón pueda llevar** para reabrir el permiso, ni en iOS
 * ni en Chrome. Lo único honesto es explicar dónde está en los ajustes del
 * sistema, así que eso es lo que hace.
 */
function rowHint(state: PushState | null, registered: boolean): string {
  switch (state) {
    case null: return "Comprobando…";
    case "granted": return registered ? "Activadas en este dispositivo" : "Este dispositivo no quedó registrado";
    case "prompt": return "Sin activar en este dispositivo";
    case "ios-needs-install": return "Primero agregá la app a la pantalla de inicio";
    case "denied": return "El navegador las está bloqueando";
    case "insecure": return "Esta dirección no las admite";
    default: return "Este navegador no las soporta";
  }
}

export function PushNotificationsSection() {
  const [state, setState] = useState<PushState | null>(null);
  const [registered, setRegistered] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  // Se le pregunta al backend, no a localStorage: un dato local no puede
  // contestar una pregunta sobre el servidor. Guardarlo local hacía que en un
  // segundo navegador la pantalla dijera "no quedó registrado" con el
  // dispositivo perfectamente registrado.
  //
  // Ante la duda se asume registrado: es mejor no decir nada que acusar en
  // falso de un problema que no existe.
  const refreshRegistered = async () => {
    try {
      const res = await api.get<{ count: number }>("/notifications/device-tokens/me");
      setRegistered(res.data.count > 0);
    } catch {
      setRegistered(true);
    }
  };

  // En un efecto, no en el render: `Notification.permission` no existe en el
  // server y leerlo durante el render desincroniza la hidratación.
  useEffect(() => {
    setState(pushState());
    refreshRegistered();
  }, []);

  const activate = async () => {
    setBusy(true);
    try {
      setState(await enablePush());
      await refreshRegistered();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingsRow icon={Bell} title="Notificaciones" hint={rowHint(state, registered)} onClick={() => setOpen(true)} />
      {open && (
        <FormSheet title="Notificaciones" onClose={() => setOpen(false)}>
          <div className={`${FORM_SHEET_BODY} !pb-4`}>
            <p className={`${SHEET_TEXT} px-1.5`}>
              Avisos en el celular o la compu cuando alguien te comparte un gasto,
              sin tener que entrar a la app.
            </p>

            {state === null && <p className={`${SHEET_TEXT} px-1.5`}>Comprobando…</p>}

            {state === "granted" && registered && (
              <div className={`${SHEET_BLOCK} flex items-center gap-2`}>
                <CheckCircle2 className="w-[18px] h-[18px] text-[#3B2FB3] shrink-0" />
                <span className="text-[15px] font-medium text-foreground">Activadas en este dispositivo</span>
              </div>
            )}

            {/* Permiso concedido pero el dispositivo nunca llegó a registrarse. Antes
                esto se mostraba como "Activadas" y no llegaba nada, que es la peor
                combinación posible: parece que funciona y no hay dónde mirar. */}
            {state === "granted" && !registered && (
              <div className={SHEET_NOTICE}>
                <div className="flex items-center gap-2">
                  <TriangleAlert className="w-4 h-4 text-[#3B2FB3] shrink-0" />
                  <p className="text-[15px] font-semibold text-foreground">
                    Diste el permiso, pero este dispositivo no quedó registrado
                  </p>
                </div>
                <p className={SHEET_TEXT}>
                  {pushConfigProblem() ?? "No se pudo obtener el identificador del dispositivo."}
                  {" "}Los avisos no van a llegar hasta que esto se resuelva.
                </p>
                <SheetButton onClick={activate} disabled={busy} variant="outline" className="!mt-2.5">
                  {busy ? "Reintentando…" : "Reintentar"}
                </SheetButton>
              </div>
            )}

            {state === "prompt" && (
              <SheetButton onClick={activate} disabled={busy}>
                <Bell className="w-4 h-4 shrink-0" />
                {busy ? "Activando…" : "Activar notificaciones"}
              </SheetButton>
            )}

            {/* iOS sin instalar: el permiso ni siquiera se puede pedir, así que un
                botón acá sería un botón que no hace nada. */}
            {state === "ios-needs-install" && (
              <div className={SHEET_NOTICE}>
                <div className="flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-[#3B2FB3] shrink-0" />
                  <p className="text-[15px] font-semibold text-foreground">
                    Primero agregá la app a la pantalla de inicio
                  </p>
                </div>
                <p className={SHEET_TEXT}>
                  En iPhone y iPad, Safari sólo entrega notificaciones si la app está
                  instalada. Desde Safari, buscá <strong>Compartir</strong> y después{" "}
                  <strong>Agregar a Inicio</strong>. Después abrí la app desde el ícono
                  nuevo y volvé acá.{" "}
                  <a href={siteHref("/instalar")} className="font-semibold text-[#3B2FB3] underline">Ver el paso a paso</a>
                </p>
              </div>
            )}

            {state === "denied" && (
              <div className={SHEET_NOTICE}>
                <div className="flex items-center gap-2">
                  <BellOff className="w-4 h-4 text-[#3B2FB3] shrink-0" />
                  <p className="text-[15px] font-semibold text-foreground">
                    El navegador está bloqueando las notificaciones
                  </p>
                </div>
                {/* NO se afirma que el usuario las rechazó: `Notification.permission`
                    devuelve "denied" también cuando el navegador las tiene apagadas a
                    nivel general, sin que nadie haya tocado nada en este sitio. */}
                <p className={SHEET_TEXT}>
                  Puede ser que estén rechazadas para este sitio, o apagadas para
                  todos. Hay que habilitarlas a mano:
                </p>
                {isIOS() ? (
                  <p className={SHEET_TEXT}>
                    <strong>Ajustes</strong> del iPhone → buscá <strong>tood</strong> (o <strong>RegistrApp</strong>, si la instalaste antes del cambio de nombre) en
                    la lista de apps → <strong>Notificaciones</strong> → activá
                    <strong> Permitir notificaciones</strong>.
                  </p>
                ) : (
                  <>
                    <p className={SHEET_TEXT}>
                      Tocá el <strong>candado</strong> a la izquierda de la dirección
                      web → <strong>Notificaciones</strong> → <strong>Permitir</strong>,
                      y recargá.
                    </p>
                    <p className={SHEET_TEXT}>
                      Si ahí aparece en &quot;Preguntar&quot; y aun así no funciona, revisá el
                      permiso general: en Chrome, <strong>Configuración</strong> →
                      <strong> Privacidad y seguridad</strong> →
                      <strong> Configuración de sitios</strong> →
                      <strong> Notificaciones</strong>.
                    </p>
                  </>
                )}
              </div>
            )}

            {state === "insecure" && (
              <div className={SHEET_NOTICE}>
                <div className="flex items-center gap-2">
                  <TriangleAlert className="w-4 h-4 text-[#3B2FB3] shrink-0" />
                  <p className="text-[15px] font-semibold text-foreground">
                    Esta dirección no admite notificaciones
                  </p>
                </div>
                <p className={SHEET_TEXT}>
                  Ningún navegador las entrega en un sitio sin HTTPS. Entrá por
                  <strong> localhost</strong> o por la dirección de producción, que sí
                  lo tiene. No es un permiso que puedas cambiar.
                </p>
              </div>
            )}

            {state === "unsupported" && (
              <div className={`${SHEET_BLOCK} flex items-start gap-2`}>
                <TriangleAlert className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <p className={SHEET_TEXT}>
                  Este navegador no soporta notificaciones. Probá desde Chrome o Safari
                  actualizados.
                </p>
              </div>
            )}
          </div>
        </FormSheet>
      )}
    </>
  );
}
