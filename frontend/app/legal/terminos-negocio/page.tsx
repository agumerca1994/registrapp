import type { Metadata } from "next";
import { LegalPage, List, Section, sectionsOf } from "@/components/legal/LegalPage";
import { TermsHead, TermsTail, termsSections } from "@/components/legal/terms";

export const metadata: Metadata = {
  title: "Términos y condiciones de RegistrApp Negocio",
  description: "Las reglas para usar RegistrApp en un comercio, con tu equipo.",
};

/**
 * Lo propio de un negocio: el dueño decide quién entra y qué ve cada uno, y
 * los datos de empleados y proveedores los carga el negocio, que es su
 * responsable; nosotros los tratamos por cuenta de él (art. 25 Ley 25.326).
 */
const SECTIONS = termsSections([
  { id: "que-es", title: "Qué es RegistrApp Negocio" },
  { id: "equipo", title: "Tu equipo y sus permisos" },
  { id: "terceros", title: "Datos de empleados, proveedores y clientes" },
  { id: "fiscal", title: "Obligaciones fiscales y contables" },
  { id: "caja", title: "Ventas, caja y stock" },
]);
const sec = sectionsOf(SECTIONS);

export default function TerminosNegocioPage() {
  return (
    <LegalPage
      title="Términos y condiciones de RegistrApp Negocio"
      sections={SECTIONS}
      intro={<p>Estos términos son para las cuentas de tipo <strong>Negocio</strong>. Si usás RegistrApp para las cuentas de tu casa, leé los de RegistrApp Hogar.</p>}
    >
      <TermsHead sec={sec} variant="negocio" />

      <Section {...sec("que-es")}>
        <p>
          Una app para llevar las cuentas de un comercio chico: ventas, cierre de caja, productos y stock,
          proveedores y empleados, gastos, tarjetas y el resultado del mes. Sirve para registrar y ordenar: no
          cobra, no emite facturas ni se conecta con tu banco.
        </p>
        <p>
          Quien crea el negocio declara que tiene facultades para representarlo y acepta estos términos en su
          nombre.
        </p>
      </Section>

      <Section {...sec("equipo")}>
        <List items={[
          <><strong>Dueño y socios</strong> ven y administran todo. El dueño decide quién es socio.</>,
          <><strong>Empleados</strong>: quien se suma con el código del negocio entra como empleado. Carga ventas,
            el cierre y el stock, sólo de hoy y de ayer, y no ve los números del negocio, el código ni los demás
            miembros.</>,
          "Sos responsable de a quién le das acceso y de lo que carga tu equipo. Si alguien deja de trabajar con vos, sacalo del negocio.",
          "Si el dueño se va, el negocio pasa al socio más antiguo. Un empleado nunca queda a cargo de un negocio.",
        ]} />
      </Section>

      <Section {...sec("terceros")}>
        <p>
          Los datos de tus empleados, proveedores y clientes que cargues en la app (nombres, montos, pagos) los
          decidís cargar vos. Respecto de ellos, <strong>el negocio es el responsable</strong> en los términos de
          la Ley 25.326, y nosotros los tratamos por cuenta del negocio, sólo para prestarle el servicio (art. 25
          de esa ley).
        </p>
        <List items={[
          "Cargá sólo los datos que necesitás para llevar tus cuentas, y asegurate de tener derecho a hacerlo.",
          "Si una de esas personas te pide acceder, corregir o borrar sus datos, la respuesta es tuya. Te ayudamos si nos escribís.",
          "No usamos esos datos para nada más ni los compartimos con nadie fuera de lo que dice la política de privacidad.",
        ]} />
      </Section>

      <Section {...sec("fiscal")}>
        <p>
          RegistrApp <strong>no reemplaza tu facturación, tus libros contables ni tus obligaciones ante ARCA</strong>{" "}
          u otros organismos. Los resultados que muestra (ventas, egresos, resultado del mes) sirven para seguir
          tu negocio y no son una liquidación de impuestos. Consultá con tu contador.
        </p>
      </Section>

      <Section {...sec("caja")}>
        <List items={[
          "Las ventas del día se suman en un único ingreso por día. Si cargaste el cierre de caja, cuenta lo contado; si no, la suma de los tickets.",
          "El día del negocio termina a las 5 de la mañana: lo vendido a las 0:30 cuenta para el día anterior.",
          "Una venta nunca se frena por falta de stock: si el stock queda negativo, la app te avisa para que cargues la producción o la compra.",
          "El stock es el que surge de lo que se cargó. No es un recuento físico: contá y ajustá cuando haga falta.",
        ]} />
      </Section>

      <TermsTail sec={sec} variant="negocio" />
    </LegalPage>
  );
}
