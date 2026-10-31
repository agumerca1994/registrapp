import Link from "next/link";
import { appHref } from "@/lib/site";
import { ToodLogoAnimado } from "@/components/brand/ToodLogoAnimado";

type Section = "home" | "hogar" | "negocio" | "conectar";

const LINKS: { key: Exclude<Section, "home">; href: string; label: string; hide: string }[] = [
  { key: "hogar", href: "/hogar", label: "Hogar", hide: "hidden sm:inline" },
  { key: "negocio", href: "/negocio", label: "Negocio", hide: "hidden sm:inline" },
  { key: "conectar", href: "/conectar", label: "Con IA", hide: "hidden md:inline" },
];

// El header de las páginas públicas: el mismo en la home, Hogar, Negocio y Con IA, para que moverse entre ellas
// no cambie la barra. El logo es el animado (al bajar, la t se vuelve el avatar y te sigue con la mirada) y,
// fuera de la home, lleva a la home. La sección en la que estás queda marcada, y en el celular es el único link
// que se ve además de Entrar: así se sabe dónde estás.
export default function SiteHeader({ current }: { current: Section }) {
  const logo = <ToodLogoAnimado variant="ojos" className="h-8 w-auto text-primary" />;
  return (
    <header className="sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-border"
      style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="max-w-6xl mx-auto px-4 md:px-8 h-16 flex items-center gap-2">
        {current === "home" ? logo : <Link href="/" aria-label="tood, ir a la home">{logo}</Link>}
        <nav className="ml-auto flex items-center gap-1 sm:gap-2">
          {LINKS.map((l) => (
            <Link key={l.key} href={l.href} aria-current={current === l.key ? "page" : undefined}
              className={`${current === l.key ? "" : l.hide} px-3 py-2 text-sm font-medium ${current === l.key
                ? "text-foreground underline decoration-2 decoration-primary underline-offset-8"
                : "text-muted-foreground hover:text-foreground"}`}>
              {l.label}
            </Link>
          ))}
          <Link href={appHref("/login")} className="inline-flex items-center rounded-full border-2 border-ink bg-white px-4 py-2 text-sm font-semibold shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
            Entrar
          </Link>
        </nav>
      </div>
    </header>
  );
}
