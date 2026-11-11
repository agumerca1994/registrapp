import { redirect } from "next/navigation";

// Ahorro pasó a llamarse Objetivos: los links viejos llevan ahí.
export default async function AhorroGoalRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/objetivos/${id}`);
}
