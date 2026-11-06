"use client";

import { useParams, useRouter } from "next/navigation";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { CreditView } from "@/components/creditos/CreditView";

export default function CreditoPage() {
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  return <CreditView key={id} id={Number(id)} onDeleted={() => router.push("/creditos")} />;
}
