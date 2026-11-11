import { redirect } from "next/navigation";

// Ahorro pasó a llamarse Objetivos: los links viejos llevan ahí.
export default function AhorroRedirect() {
  redirect("/objetivos");
}
