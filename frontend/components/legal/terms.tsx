import Link from "next/link";
import { List, Mail, Section } from "@/components/legal/LegalPage";
import { LEGAL } from "@/lib/legal";

/**
 * Cláusulas comunes a los términos de Hogar y de Negocio. Estructura tomada de
 * la plantilla "Terms of Use" de General Legal (CC0), sin el arbitraje ni las
 * leyes de EE.UU.: acá rigen la Ley 24.240 de Defensa del Consumidor y el
 * Código Civil y Comercial, que anulan cualquier renuncia de derechos del
 * usuario o cláusula que desnaturalice las obligaciones (art. 37 LDC, arts.
 * 988 y 1119 CCyC). Por eso no hay exclusión total de responsabilidad ni
 * jurisdicción fuera del domicilio del usuario.
 *
 * Cada página arma su lista con `termsSections(propias)`, que pone las
 * secciones propias entre la cabecera y el cierre comunes.
 */

type Variant = "hogar" | "negocio";
type Sec = (id: string) => { id: string; n: number; title: string };

const HEAD = [
  { id: "servicio", title: "Quién presta el servicio" },
  { id: "cuenta", title: "Tu cuenta" },
  { id: "uso", title: "Uso aceptable" },
];
const TAIL = [
  { id: "canales", title: "WhatsApp y asistentes de IA" },
  { id: "precio", title: "Precio" },
  { id: "propiedad", title: "Propiedad intelectual" },
  { id: "disponibilidad", title: "Disponibilidad y cambios en la app" },
  { id: "responsabilidad", title: "Responsabilidad" },
  { id: "baja", title: "Baja y eliminación de la cuenta" },
  { id: "consumidor", title: "Defensa del consumidor" },
  { id: "ley", title: "Ley aplicable y jurisdicción" },
  { id: "cambios", title: "Cambios en estos términos y contacto" },
];

export function termsSections(own: { id: string; title: string }[]) {
  return [...HEAD, ...own, ...TAIL];
}

const NAME: Record<Variant, string> = { hogar: "RegistrApp Hogar", negocio: "RegistrApp Negocio" };

export function TermsHead({ sec, variant }: { sec: Sec; variant: Variant }) {
  const group = variant === "hogar" ? "hogar" : "negocio";
  return (
    <>
      <Section {...sec("servicio")}>
        <p>
          {NAME[variant]} es un servicio de <strong>{LEGAL.owner}</strong> (en adelante, &quot;nosotros&quot;).
          Al crear tu cuenta aceptás estos términos y la{" "}
          <Link href="/legal/privacidad" className="font-semibold text-primary hover:underline">política de privacidad</Link>,
          que forma parte de ellos. Si no estás de acuerdo, no uses la app.
        </p>
        <p>Para usar RegistrApp tenés que ser mayor de 18 años.</p>
      </Section>

      <Section {...sec("cuenta")}>
        <List items={[
          "Entrás con tu cuenta de Google. Sos responsable de cuidar el acceso a ella y de lo que se haga desde tu cuenta.",
          "Los datos de tu perfil tienen que ser reales y estar actualizados. Al crear la cuenta te pedimos verificar tu número de WhatsApp; podés dejarlo para más tarde.",
          <>Tu {group} tiene un código para que otras personas se sumen. <strong>Compartirlo es darles acceso</strong>,
            así que pasáselo sólo a quien corresponda. Si sospechás que alguien entró sin permiso, escribinos.</>,
        ]} />
      </Section>

      <Section {...sec("uso")}>
        <p>Al usar RegistrApp te comprometés a no:</p>
        <List items={[
          "Cargar datos de otras personas sin derecho a hacerlo, o usarlos para un fin distinto del que tienen en la app.",
          "Intentar acceder a cuentas, hogares o negocios ajenos, o a partes de la app que no te corresponden.",
          "Usar la app para actividades ilícitas, para molestar a otras personas o para mandar mensajes no deseados.",
          "Sobrecargar el servicio, automatizar el acceso por fuera de los canales que ofrecemos o copiar la app para hacer un producto competidor.",
        ]} />
        <p>Si no cumplís estas reglas, podemos suspender tu cuenta, con aviso previo salvo que sea urgente.</p>
      </Section>
    </>
  );
}

export function TermsTail({ sec, variant }: { sec: Sec; variant: Variant }) {
  const loads = variant === "hogar" ? "gastos e ingresos" : "ventas, cierres, stock y gastos";
  return (
    <>
      <Section {...sec("canales")}>
        <List items={[
          <>Podés cargar {loads} escribiéndole al bot de WhatsApp. Ese canal depende de servicios de terceros y
            puede interrumpirse; si pasa, todo sigue funcionando desde la app. Revisá la confirmación que te
            manda el bot: ahí está lo que entendió.</>,
          <>Cuando el bot recibe una foto o un PDF que no sabe leer, se lo pasa a una IA para extraer los datos
            (ver la <Link href="/legal/privacidad#ia" className="underline">política de privacidad</Link>). La IA
            puede equivocarse: lo que te muestra es una propuesta.</>,
          <>Si conectás tu cuenta a un asistente de IA, ese asistente actúa en tu nombre: lo que lee y lo que carga
            con tu confirmación queda en tu cuenta como si lo hubieras hecho vos. Antes de guardar te muestra qué va
            a hacer. El asistente es de otra empresa y se rige por sus propias condiciones.</>,
        ]} />
      </Section>

      <Section {...sec("precio")}>
        <p>
          Hoy RegistrApp es gratuita. Si en el futuro sumamos un plan pago, vas a ver el precio y las condiciones
          antes de contratarlo, y nada de lo que hoy es gratis pasa a cobrarse sin que lo aceptes. Si contratás un
          plan pago, vas a poder revocar la contratación dentro de los 10 días corridos (art. 34 de la Ley 24.240)
          y darte de baja por el mismo medio por el que te diste de alta.
        </p>
      </Section>

      <Section {...sec("propiedad")}>
        <p>
          La app, su diseño, su código y su marca son nuestros. Te damos permiso para usarla según estos términos;
          no te transferimos ningún otro derecho. <strong>Los datos que cargás son tuyos</strong>: sólo los usamos
          para prestarte el servicio, como explica la política de privacidad.
        </p>
        <p>Si nos mandás sugerencias, podemos usarlas para mejorar la app sin deberte nada por eso.</p>
      </Section>

      <Section {...sec("disponibilidad")}>
        <p>
          Trabajamos para que la app funcione siempre, pero puede haber interrupciones por mantenimiento, fallas o
          causas ajenas. Podemos cambiar, agregar o quitar funciones. Si quitamos algo importante para vos o
          decidimos dejar de prestar el servicio, te avisamos con al menos 30 días de anticipación para que
          puedas pedirnos una copia de tus datos.
        </p>
      </Section>

      <Section {...sec("responsabilidad")}>
        <List items={[
          <>RegistrApp es una herramienta para ordenar tus cuentas. <strong>No es asesoramiento financiero,
            contable, impositivo ni legal</strong>, y las decisiones que tomes con esa información son tuyas.</>,
          "Los cálculos dependen de los datos que se cargan. Si un dato está mal cargado, el resultado también va a estar mal.",
          "Las cotizaciones, el índice de inflación y el valor de la UVA salen de fuentes públicas y pueden demorarse o tener errores. Son de referencia.",
          "No respondemos por fallas de servicios de terceros (Google, WhatsApp, tu proveedor de internet, el asistente de IA que conectes) ni por el uso que hagan otras personas a quienes les diste acceso.",
          "Nada de esto limita los derechos que te da la Ley 24.240 de Defensa del Consumidor ni nuestra responsabilidad por dolo o culpa grave.",
        ]} />
      </Section>

      <Section {...sec("baja")}>
        <p>
          Podés eliminar tu cuenta cuando quieras desde <strong>Configuración</strong>. <strong>Es definitivo y no
          se puede deshacer.</strong> Qué se borra y qué queda (por ejemplo, lo que cargaste en un{" "}
          {variant === "hogar" ? "hogar" : "negocio"} donde siguen otras personas) está explicado en la{" "}
          <Link href="/legal/privacidad#eliminar" className="underline">política de privacidad</Link>.
        </p>
        <p>
          Nosotros podemos dar de baja una cuenta que no cumpla estos términos, con aviso previo salvo que sea
          urgente (por ejemplo, un acceso indebido o un riesgo para otros usuarios).
        </p>
      </Section>

      <Section {...sec("consumidor")}>
        <p>
          Si tenés un reclamo, escribinos primero a <Mail /> y te respondemos lo antes posible. Siempre podés
          acudir a la autoridad de defensa del consumidor de tu jurisdicción o hacer tu reclamo en la{" "}
          <a href="https://www.argentina.gob.ar/produccion/defensadelconsumidor/formulario" target="_blank"
            rel="noopener noreferrer" className="underline">Ventanilla Única Federal de Defensa del Consumidor</a>.
        </p>
      </Section>

      <Section {...sec("ley")}>
        <p>
          Estos términos se rigen por las leyes de la República Argentina. Ante un conflicto, son competentes los
          tribunales ordinarios correspondientes a tu domicilio.
        </p>
      </Section>

      <Section {...sec("cambios")}>
        <p>
          Si cambiamos estos términos, actualizamos la fecha de arriba y, si el cambio es importante, te avisamos
          en la app con anticipación. Si no estás de acuerdo con la nueva versión, podés eliminar tu cuenta antes
          de que rija.
        </p>
        <p>Consultas: <Mail />.</p>
      </Section>
    </>
  );
}
