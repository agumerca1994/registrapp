"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, CheckCircle2, Smartphone, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { enablePush, isDeviceRegistered, isIOS, pushConfigProblem, pushState, type PushState } from "@/lib/push";

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
 * una URL a la que un botón pueda llevar** para reabrir el permiso — ni en iOS
 * ni en Chrome. Lo único honesto es explicar dónde está en los ajustes del
 * sistema, así que eso es lo que hace.
 */
export function PushNotificationsSection() {
  const [state, setState] = useState<PushState | null>(null);
  const [registered, setRegistered] = useState(true);
  const [busy, setBusy] = useState(false);

  // En un efecto, no en el render: `Notification.permission` no existe en el
  // server y leerlo durante el render desincroniza la hidratación.
  useEffect(() => {
    setState(pushState());
    setRegistered(isDeviceRegistered());
  }, []);

  const activate = async () => {
    setBusy(true);
    try {
      setState(await enablePush());
      setRegistered(isDeviceRegistered());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-6 space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Bell className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-foreground">Notificaciones</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Avisos en el celular o la compu cuando alguien te comparte un gasto,
          sin tener que entrar a la app.
        </p>
      </div>

      {state === null && <p className="text-sm text-muted-foreground">Comprobando…</p>}

      {state === "granted" && registered && (
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="text-sm text-foreground">Activadas en este dispositivo</span>
        </div>
      )}

      {/* Permiso concedido pero el dispositivo nunca llegó a registrarse. Antes
          esto se mostraba como "Activadas" y no llegaba nada, que es la peor
          combinación posible: parece que funciona y no hay dónde mirar. */}
      {state === "granted" && !registered && (
        <div className="rounded-xl border-2 border-ink bg-amber-50 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <TriangleAlert className="w-4 h-4 text-amber-700 shrink-0" />
            <p className="text-sm font-medium text-foreground">
              Diste el permiso, pero este dispositivo no quedó registrado
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {pushConfigProblem() ?? "No se pudo obtener el identificador del dispositivo."}
            {" "}Los avisos no van a llegar hasta que esto se resuelva.
          </p>
          <Button onClick={activate} disabled={busy} variant="outline" className="w-full sm:w-auto">
            {busy ? "Reintentando…" : "Reintentar"}
          </Button>
        </div>
      )}

      {state === "prompt" && (
        <Button onClick={activate} disabled={busy} className="w-full sm:w-auto">
          <Bell className="w-4 h-4 shrink-0" />
          {busy ? "Activando…" : "Activar notificaciones"}
        </Button>
      )}

      {/* iOS sin instalar: el permiso ni siquiera se puede pedir, así que un
          botón acá sería un botón que no hace nada. */}
      {state === "ios-needs-install" && (
        <div className="rounded-xl border-2 border-ink bg-accent/40 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-primary shrink-0" />
            <p className="text-sm font-medium text-foreground">
              Primero agregá la app a la pantalla de inicio
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            En iPhone y iPad, Safari sólo entrega notificaciones si la app está
            instalada. Desde Safari: tocá <strong>Compartir</strong> (el cuadrado
            con la flecha) → <strong>Agregar a pantalla de inicio</strong>. Después
            abrí la app desde el ícono nuevo y volvé acá.
          </p>
        </div>
      )}

      {state === "denied" && (
        <div className="rounded-xl border-2 border-ink bg-amber-50 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <BellOff className="w-4 h-4 text-amber-700 shrink-0" />
            <p className="text-sm font-medium text-foreground">
              Las notificaciones están bloqueadas
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            El permiso se rechazó una vez y el navegador ya no vuelve a
            preguntar, así que hay que habilitarlo a mano:
          </p>
          {isIOS() ? (
            <p className="text-xs text-muted-foreground">
              <strong>Ajustes</strong> del iPhone → buscá <strong>RegistrApp</strong> en
              la lista de apps → <strong>Notificaciones</strong> → activá
              <strong> Permitir notificaciones</strong>.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Tocá el <strong>candado</strong> a la izquierda de la dirección web
              → <strong>Notificaciones</strong> → <strong>Permitir</strong>. Después
              recargá la página.
            </p>
          )}
        </div>
      )}

      {state === "unsupported" && (
        <div className="flex items-start gap-2">
          <TriangleAlert className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            Este navegador no soporta notificaciones. Probá desde Chrome o Safari
            actualizados.
          </p>
        </div>
      )}
    </Card>
  );
}
