import Link from "next/link";
import { appHref } from "@/lib/site";
import { ToodLogo } from "@/components/brand/ToodLogo";

/** Pie de las páginas públicas. Lleva los documentos legales: tienen que poder alcanzarse desde cualquiera. */
export default function SiteFooter() {
  return (
    <footer className="border-t border-border" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 text-sm text-muted-foreground flex flex-wrap gap-x-6 gap-y-2">
        <Link href="/" aria-label="tood, ir a la home"><ToodLogo className="h-5 w-auto text-foreground" /></Link>
        <Link href="/hogar" className="hover:text-foreground">Hogar</Link>
        <Link href="/negocio" className="hover:text-foreground">Negocio</Link>
        <Link href="/conectar" className="hover:text-foreground">Conectar con Claude</Link>
        <Link href={appHref("/login")} className="sm:ml-auto hover:text-foreground">Entrar a la app</Link>
      </div>
      <div className="max-w-6xl mx-auto px-4 md:px-8 pb-6 text-sm text-muted-foreground flex flex-wrap gap-x-6 gap-y-2">
        <Link href="/legal/privacidad" className="hover:text-foreground">Privacidad</Link>
        <Link href="/legal/terminos-hogar" className="hover:text-foreground">Términos Hogar</Link>
        <Link href="/legal/terminos-negocio" className="hover:text-foreground">Términos Negocio</Link>
        <Link href="/legal" className="hover:text-foreground">Legales</Link>
      </div>
    </footer>
  );
}
