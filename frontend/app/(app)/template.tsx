/**
 * Cambiar de pantalla funde en vez de cortar. Sólo opacidad y sin dejarla puesta:
 * un `transform` haría que los `fixed` de adentro se ubiquen contra este bloque.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
