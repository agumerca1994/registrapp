import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, List, Mail, Section, sectionsOf } from "@/components/legal/LegalPage";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Política de privacidad · RegistrApp",
  description: "Qué datos guarda RegistrApp, para qué, con quién los comparte y cómo ejercés tus derechos.",
};

/**
 * Política de privacidad (Ley 25.326 y Decreto 1558/2001). Estructura tomada
 * de la plantilla "Privacy Policy (GDPR Enhanced)" de General Legal (CC0),
 * reescrita para la ley argentina. Cada afirmación describe lo que la app hace
 * hoy: si cambia el código (un proveedor nuevo, analítica, otro plazo de
 * guarda), cambia este texto.
 */

const SECTIONS = [
  { id: "responsable", title: "Quién es responsable" },
  { id: "datos", title: "Qué datos guardamos" },
  { id: "usos", title: "Para qué los usamos" },
  { id: "ia", title: "Inteligencia artificial" },
  { id: "terceros", title: "Con quién los compartimos" },
  { id: "transferencia", title: "Transferencia internacional" },
  { id: "visibilidad", title: "Qué ven otras personas" },
  { id: "plazos", title: "Cuánto tiempo los guardamos" },
  { id: "eliminar", title: "Eliminar tu cuenta" },
  { id: "derechos", title: "Tus derechos" },
  { id: "seguridad", title: "Seguridad" },
  { id: "navegador", title: "Cookies y almacenamiento" },
  { id: "menores", title: "Menores de edad" },
  { id: "cambios", title: "Cambios en esta política" },
  { id: "contacto", title: "Contacto y autoridad de control" },
];
const sec = sectionsOf(SECTIONS);

export default function PrivacidadPage() {
  return (
    <LegalPage
      title="Política de privacidad"
      sections={SECTIONS}
      intro={<>
        <p>
          RegistrApp es una aplicación para llevar las cuentas de un hogar o de un comercio chico. Para funcionar
          necesita guardar información sobre tu plata: ingresos, gastos, tarjetas, dólares, ventas. Sabemos que es
          información sensible, y esta política explica qué hacemos con ella.
        </p>
        <p>
          Se rige por la Ley 25.326 de Protección de los Datos Personales, su Decreto Reglamentario 1558/2001 y
          las normas de la Agencia de Acceso a la Información Pública (AAIP). Al crear tu cuenta prestás tu
          consentimiento libre, expreso e informado para el tratamiento que se describe acá.
        </p>
      </>}
    >
      <Section {...sec("responsable")}>
        <p>
          El responsable de la base de datos es <strong>{LEGAL.owner}</strong>. Para cualquier consulta sobre tus
          datos escribinos a <Mail />.
        </p>
      </Section>

      <Section {...sec("datos")}>
        <p><strong>Los que nos das vos:</strong></p>
        <List items={[
          "Tu cuenta de Google: nombre y dirección de correo. No recibimos ni guardamos tu contraseña de Google.",
          "Tu perfil: nombre, apellido, alias y el nombre de tu hogar o negocio.",
          "Tu número de WhatsApp, si lo vinculás.",
          "Lo que cargás en la app: ingresos y su detalle, gastos, categorías, tarjetas y sus resúmenes, cuotas, operaciones en dólares, hipoteca, recordatorios, gastos compartidos, contactos de tu agenda, y en un negocio: ventas, cierres de caja, productos, stock, proveedores y empleados.",
          "Los mensajes que le mandás al bot de WhatsApp, y los archivos que le mandás para cargar (comprobantes, fotos, resúmenes en PDF).",
          "Los resúmenes de tarjeta que subís para compararlos con lo cargado.",
        ]} />
        <p><strong>Los que se generan al usar la app:</strong></p>
        <List items={[
          "El identificador de tu dispositivo para mandarte notificaciones, si las activás.",
          "Registros técnicos de errores, con la página donde ocurrieron y tu número de usuario, para poder arreglarlos.",
          "Tu dirección IP, de forma transitoria, para limitar abusos (por ejemplo, demasiadas búsquedas seguidas).",
          "Las conexiones con asistentes de IA que autorizás, y el registro de lo que cargaron o cambiaron en tu cuenta.",
        ]} />
        <p>
          <strong>Datos de otras personas.</strong> Cuando compartís un gasto, sumás a alguien a tu agenda o cargás
          un proveedor o un empleado, guardás datos de un tercero (nombre, mail o teléfono). Cargalos sólo si
          tenés derecho a hacerlo y para el fin para el que existen.
        </p>
        <p>
          <strong>Lo que no hacemos.</strong> No guardamos los PDF de tus resúmenes: se leen en memoria y se guardan
          sólo los movimientos, sin tu domicilio ni tus números de cuenta. No guardamos las contraseñas de los PDF
          que nos mandás por WhatsApp. No pedimos tus claves del banco ni nos conectamos con tu banco.
        </p>
      </Section>

      <Section {...sec("usos")}>
        <List items={[
          "Prestarte el servicio: mostrar tus cuentas, calcular totales, repartir cuotas, comparar tu resumen con lo cargado.",
          "Identificarte cuando entrás y proteger tu cuenta.",
          "Avisarte de lo que te concierne: un gasto que te compartieron, un recordatorio de pago, un código de verificación. No te mandamos publicidad.",
          "Sugerirte categorías a partir de lo que ya cargaste antes.",
          "Arreglar errores y mejorar la app.",
          "Cumplir obligaciones legales y responder a pedidos de autoridades competentes.",
        ]} />
        <p>
          No vendemos tus datos, no los usamos para publicidad ni armamos perfiles para terceros. La app no tiene
          herramientas de analítica ni de publicidad de terceros.
        </p>
      </Section>

      <Section {...sec("ia")}>
        <p>Usamos inteligencia artificial en dos casos, y en los dos la IA lee pero no decide por vos:</p>
        <List items={[
          <>Cuando le mandás al bot una foto o un PDF que nuestro código no sabe leer, se lo enviamos a la IA de
            Anthropic (Claude) para que extraiga el monto, la fecha y el comercio. Antes de guardar, el bot te
            muestra lo que entendió.</>,
          <>Cuando subís un resumen de tarjeta y hay consumos sin categoría, le enviamos a esa IA la descripción de
            esos consumos y la lista de tus categorías para que sugiera una. La sugerencia se muestra como tal y
            podés cambiarla.</>,
        ]} />
        <p>
          Además, <strong>vos podés conectar tu cuenta a un asistente de IA</strong> (por ejemplo, Claude) desde
          Configuración. Si lo hacés, ese asistente puede leer los datos de tu hogar o negocio y, con tu
          confirmación, cargar o corregir datos. Lo que el asistente hace con esa información se rige por las
          condiciones del proveedor que elegiste y por tu cuenta con él. Podés desconectarlo cuando quieras desde
          Configuración, y la conexión deja de funcionar en el momento.
        </p>
      </Section>

      <Section {...sec("terceros")}>
        <p>Compartimos datos sólo con los proveedores que necesitamos para que la app funcione:</p>
        <List items={[
          "Google (Firebase): el inicio de sesión con tu cuenta de Google y el envío de notificaciones.",
          "Anthropic: la lectura de comprobantes y las sugerencias de categoría descriptas arriba.",
          "El servicio de mensajería que conecta el bot con WhatsApp: los mensajes que intercambiás con el bot y los avisos que te mandamos.",
          "El proveedor de servidores donde corren la app y la base de datos.",
        ]} />
        <p>
          Esos proveedores tratan los datos por cuenta nuestra y sólo para prestarnos su servicio. También podemos
          revelar datos si nos lo exige una orden judicial o una autoridad competente.
        </p>
        <p>
          Para mostrar la cotización del dólar y la inflación usamos fuentes públicas. A esas fuentes no les
          enviamos ningún dato tuyo.
        </p>
      </Section>

      <Section {...sec("transferencia")}>
        <p>
          Algunos de esos proveedores, como Google y Anthropic, guardan o procesan la información en los Estados
          Unidos u otros países, que pueden no tener el mismo nivel de protección que la Argentina. Al aceptar esta
          política consentís esa transferencia internacional, que hacemos sólo en la medida necesaria para prestar
          el servicio (art. 12 de la Ley 25.326).
        </p>
      </Section>

      <Section {...sec("visibilidad")}>
        <List items={[
          <><strong>En un hogar,</strong> todas las personas que se suman con el código del hogar ven y cargan lo
            mismo. Compartir el código es darle acceso a todo.</>,
          <><strong>En un negocio,</strong> el dueño y los socios ven todo. Los empleados ven y cargan ventas y
            stock, y no ven los números del negocio ni los datos de los demás miembros.</>,
          <><strong>Cuando compartís un gasto,</strong> cada participante ve el gasto, el total, su parte y los
            nombres de los demás participantes.</>,
          <><strong>Tu alias</strong> permite que otras personas te encuentren para compartirte un gasto. También
            pueden buscarte por nombre, salvo que lo desactives en Configuración. Nunca mostramos tu mail ni tu
            teléfono a quien te busca.</>,
        ]} />
      </Section>

      <Section {...sec("plazos")}>
        <List items={[
          "Lo que cargás en la app se guarda mientras tengas tu cuenta.",
          "Los mensajes del bot de WhatsApp se borran a los 7 días. Sólo se guardan para poder deshacer o corregir lo último que cargaste.",
          "Los links de acceso que manda el bot vencen a los 15 minutos y se usan una sola vez.",
          "Las conexiones con asistentes de IA que se revocan o vencen se borran a los 30 días.",
          "Los registros técnicos de errores se guardan el tiempo necesario para resolverlos.",
        ]} />
      </Section>

      <Section {...sec("eliminar")}>
        <p>
          Podés eliminar tu cuenta en cualquier momento desde <strong>Configuración</strong>. <strong>La
          eliminación es definitiva y no se puede deshacer.</strong>
        </p>
        <List items={[
          "Se borran tus datos personales: nombre, alias, mail, teléfono, conexiones con asistentes de IA y dispositivos registrados.",
          "Si sos la única persona de tu hogar o negocio, se borra también todo lo cargado en él.",
          "Si quedan otras personas, lo cargado en el hogar o negocio sigue siendo de ellas, porque también es suyo. En un negocio, si te vas como dueño, el negocio pasa al socio más antiguo.",
          "Los gastos que compartiste con personas de otros hogares siguen en las cuentas de ellas, con el nombre con el que figurabas.",
        ]} />
        <p>
          Si preferís, también podés pedir la eliminación escribiendo a <Mail />. La información puede quedar en
          las copias de seguridad hasta que se renueven en su ciclo habitual, y sólo se usa para restaurar el
          servicio ante una falla.
        </p>
      </Section>

      <Section {...sec("derechos")}>
        <p>Como titular de los datos tenés derecho a:</p>
        <List items={[
          "Acceder a tus datos en forma gratuita, a intervalos no menores a seis meses salvo interés legítimo. Respondemos dentro de los 10 días corridos (art. 14 de la Ley 25.326).",
          "Rectificarlos, actualizarlos o suprimirlos. Respondemos dentro de los 5 días hábiles (art. 16).",
          "Retirar tu consentimiento en cualquier momento, lo que puede implicar dejar de usar la app.",
        ]} />
        <p>
          Gran parte de tus datos los podés ver y corregir vos desde la app. Para todo lo demás, escribinos a{" "}
          <Mail /> desde el mail de tu cuenta. Podemos pedirte que acredites tu identidad.
        </p>
      </Section>

      <Section {...sec("seguridad")}>
        <p>
          Usamos conexiones cifradas (HTTPS), separamos los datos de cada hogar y negocio, de las
          credenciales de acceso de los asistentes de IA guardamos sólo una huella irreversible, nunca la
          credencial, y verificamos tu número de WhatsApp
          con un código antes de vincularlo. Ningún sistema es infalible: si detectamos un incidente que afecte
          tus datos, te vamos a avisar.
        </p>
        <p>Cuidá el acceso a tu cuenta de Google y el código de tu hogar o negocio: con ellos se entra a tus datos.</p>
      </Section>

      <Section {...sec("navegador")}>
        <p>
          No usamos cookies de publicidad ni de seguimiento. La app guarda en tu navegador lo que necesita para
          funcionar: tu sesión, tus preferencias (por ejemplo, ocultar los montos), las guías que ya viste y
          borradores sin enviar. Si borrás los datos del navegador, vas a tener que volver a entrar.
        </p>
      </Section>

      <Section {...sec("menores")}>
        <p>
          RegistrApp es para mayores de 18 años. Si sabés de un menor que nos dio sus datos, escribinos y los
          borramos.
        </p>
      </Section>

      <Section {...sec("cambios")}>
        <p>
          Si cambiamos esta política, actualizamos la fecha de arriba. Si el cambio es importante (por ejemplo, un
          proveedor nuevo que recibe tus datos), te avisamos en la app antes de que rija.
        </p>
      </Section>

      <Section {...sec("contacto")}>
        <p>Consultas, pedidos y reclamos: <Mail />.</p>
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-[15px]">
          El titular de los datos personales tiene la facultad de ejercer el derecho de acceso a los mismos en
          forma gratuita a intervalos no inferiores a seis meses, salvo que se acredite un interés legítimo al
          efecto conforme lo establecido en el artículo 14, inciso 3 de la Ley Nº 25.326. La AGENCIA DE ACCESO A
          LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley Nº 25.326, tiene la atribución de
          atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por
          incumplimiento de las normas vigentes en materia de protección de datos personales.
        </p>
        <p className="text-sm text-muted-foreground">
          Ver también los términos de <Link href="/legal/terminos-hogar" className="underline">RegistrApp Hogar</Link>{" "}
          y de <Link href="/legal/terminos-negocio" className="underline">RegistrApp Negocio</Link>.
        </p>
      </Section>
    </LegalPage>
  );
}
