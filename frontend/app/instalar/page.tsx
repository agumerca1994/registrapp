import type { Metadata } from "next";
import InstallDemo from "@/components/marketing/InstallDemo";
import SiteFooter from "@/components/marketing/SiteFooter";
import SiteHeader from "@/components/marketing/SiteHeader";

export const metadata: Metadata = {
  title: "Instalar tood en el celular",
  description: "tood no está en la tienda: se instala desde el navegador, en iPhone y en Android. Mirá cómo, paso a paso.",
};

/** Pública y con su propia dirección, para poder mandarla por WhatsApp. La misma animación está en la home. */
export default function InstalarPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader current="instalar" />
      <main className="max-w-6xl mx-auto px-4 md:px-8 pt-10 md:pt-14 pb-16">
        <h1 className="font-display font-bold text-4xl md:text-5xl leading-[1.05] tracking-tight text-balance">
          Instalá tood en tu celular
        </h1>
        <p className="mt-4 text-lg text-muted-foreground max-w-2xl">
          No está en la tienda: se instala desde el navegador. Queda con su ícono, se abre sin la barra del navegador y
          te puede mandar notificaciones.
        </p>
        <InstallDemo className="mt-10" />
      </main>
      <SiteFooter />
    </div>
  );
}
