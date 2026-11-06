import { redirect } from "next/navigation";

// Hipoteca pasó a ser un tipo de crédito: los links viejos (el bot, un favorito)
// llevan a Créditos.
export default function MortgageRedirect() {
  redirect("/creditos");
}
