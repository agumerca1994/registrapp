/**
 * Feature flags. Un lugar, para que prender o apagar algo no sea buscar `if`s
 * sueltos por la app.
 *
 * Son variables `NEXT_PUBLIC_*`, así que **se hornean en el build**: cambiar
 * una en Easypanel no hace nada hasta el próximo deploy. Y tienen que estar
 * declaradas en `Dockerfile.prod` (ARG + ENV) y en los `args` de
 * `docker-compose.prod.yml`; si falta cualquiera de los dos, la variable llega
 * vacía al build y el flag queda apagado sin ningún error.
 *
 * Todo flag arranca **apagado** si la variable no está definida: una feature en
 * pausa no puede volver a aparecer porque alguien se olvidó de setear algo.
 *
 * `process.env.NEXT_PUBLIC_X` se escribe literal a propósito: Next reemplaza
 * esa expresión exacta en el build, y un acceso dinámico (`process.env[name]`)
 * no se reemplaza y vale `undefined` en el navegador.
 */
function on(value: string | undefined): boolean {
  return value === "true";
}

export const features = {
  /**
   * El Atajo de iOS: la sección de Configuración con las descargas y las
   * instrucciones de automatización. En pausa desde 2026-09.
   *
   * Apagarlo sólo esconde la oferta. `/registrar?source=shortcut` sigue
   * funcionando, así que quien ya tiene el atajo instalado no se queda con uno
   * roto.
   */
  iosShortcut: on(process.env.NEXT_PUBLIC_FEATURE_IOS_SHORTCUT),

  /**
   * "Subir resumen": subir el PDF del banco y que la app proponga los cambios
   * para que lo cargado coincida (revisión en /conciliar/[id]). Apagarlo
   * esconde los botones de Tarjetas, el aviso de pendientes y la pantalla; el
   * backend queda accesible igual.
   */
  reconcile: on(process.env.NEXT_PUBLIC_FEATURE_RECONCILE),

  /**
   * El alta pública de negocios: en /onboarding, "Crear nueva" ofrece Hogar o
   * Negocio. Apagado, el alta es la de siempre (sólo hogar) y el piloto se
   * convierte a mano con `PATCH /internal/tenants/{id}/kind`. Va junto con
   * `BUSINESS_SIGNUP_ENABLED` del backend: con uno solo prendido, o no aparece
   * la opción o el backend la rechaza con 403.
   */
  businessSignup: on(process.env.NEXT_PUBLIC_FEATURE_BUSINESS_SIGNUP),
} as const;
