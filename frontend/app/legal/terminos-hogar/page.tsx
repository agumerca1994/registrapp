import type { Metadata } from "next";
import { LegalPage, List, Section, sectionsOf } from "@/components/legal/LegalPage";
import { TermsHead, TermsTail, termsSections } from "@/components/legal/terms";

export const metadata: Metadata = {
  title: "Términos y condiciones de tood Hogar",
  description: "Las reglas para usar tood con las cuentas de tu casa.",
};

const SECTIONS = termsSections([
  { id: "que-es", title: "Qué es tood Hogar" },
  { id: "hogar", title: "Un hogar compartido" },
  { id: "compartidos", title: "Gastos compartidos" },
  { id: "referencia", title: "Dólares, hipoteca y cuotas" },
]);
const sec = sectionsOf(SECTIONS);

export default function TerminosHogarPage() {
  return (
    <LegalPage
      title="Términos y condiciones de tood Hogar"
      sections={SECTIONS}
      intro={<p>Estos términos son para las cuentas de tipo <strong>Hogar</strong>. Si usás tood en un comercio, leé los de tood Negocio.</p>}
    >
      <TermsHead sec={sec} variant="hogar" />

      <Section {...sec("que-es")}>
        <p>
          Una app para llevar las cuentas de tu casa: ingresos, gastos, tarjetas y cuotas, dólares, hipoteca UVA,
          recordatorios de pago y gastos compartidos con otras personas. Sirve para registrar y ordenar: no mueve
          plata, no hace pagos ni se conecta con tu banco.
        </p>
      </Section>

      <Section {...sec("hogar")}>
        <List items={[
          "Todas las personas que se suman a tu hogar ven, cargan, corrigen y borran lo mismo que vos. No hay datos privados de un miembro dentro del hogar.",
          "Quien creó el hogar lo administra: puede cambiarle el nombre y sacar a otros miembros.",
          "Si te vas de un hogar, lo cargado queda en él, porque también es de las demás personas.",
        ]} />
      </Section>

      <Section {...sec("compartidos")}>
        <List items={[
          "Cuando compartís un gasto, cada participante ve el total, su parte y los nombres de los demás. Sólo compartí con personas que estén de acuerdo en recibirlo.",
          "Si la persona no tiene cuenta, puede recibir una invitación por WhatsApp o un link que le pases vos. Nosotros no le cobramos ni le exigimos nada.",
          "La app lleva la cuenta de quién debe qué, pero no cobra ni transfiere: los pagos entre ustedes los arreglan por fuera.",
          "Quien recibe un gasto compartido puede aceptarlo o rechazarlo. Una vez aceptado, quien lo creó sólo puede cambiarle el título y las fechas.",
        ]} />
      </Section>

      <Section {...sec("referencia")}>
        <List items={[
          "La tenencia de dólares es la que surge de lo que cargaste. No es el saldo de tu cuenta bancaria.",
          "La cuota de la hipoteca en pesos se calcula con el valor publicado de la UVA. El monto que debitará tu banco puede diferir.",
          "Las fechas de vencimiento de las tarjetas que no cargaste son estimaciones, y la app las marca como tales.",
          "Cuando subís un resumen de tarjeta, la app propone correcciones y no aplica ninguna sin tu confirmación.",
        ]} />
      </Section>

      <TermsTail sec={sec} variant="hogar" />
    </LegalPage>
  );
}
