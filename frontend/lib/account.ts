/**
 * Hogar o negocio, y qué ve cada uno. Un solo lugar, para que la navegación,
 * las pantallas y los textos no decidan cada uno por su cuenta.
 *
 * Esto decide qué se MUESTRA. La guardia real está en el backend
 * (core/access.py): una pantalla que se cuela igual recibe 403.
 */
import type { AppUser } from "@/contexts/AuthContext";

export type TenantKind = "household" | "business";

type MaybeUser = Pick<AppUser, "tenant_kind" | "role"> | null | undefined;

export function tenantKind(user: MaybeUser): TenantKind {
  return user?.tenant_kind === "business" ? "business" : "household";
}

export function isBusiness(user: MaybeUser): boolean {
  return tenantKind(user) === "business";
}

/** Un empleado de un negocio: carga ventas y stock, y no ve números del negocio. */
export function isEmployee(user: MaybeUser): boolean {
  return isBusiness(user) && user?.role === "employee";
}

/** Lo único que ve un empleado. El backend le niega todo lo demás (core/access.py). */
export const EMPLOYEE_ROUTES = ["/ventas", "/productos", "/settings"];

/** Adónde va al abrir la app: Inicio, salvo un empleado, que no tiene Inicio. */
export function homeFor(user: MaybeUser): string {
  return isEmployee(user) ? "/ventas" : "/dashboard";
}

/** Pantallas que sólo existen en un hogar: un negocio no las ve ni en la navegación. */
export const HOUSEHOLD_ONLY_ROUTES = ["/income", "/divisas", "/shared", "/mortgage", "/macro"];
/** Y al revés. */
export const BUSINESS_ONLY_ROUTES = ["/ventas", "/productos", "/proveedores"];

function under(pathname: string, routes: string[]): boolean {
  return routes.some((r) => pathname === r || pathname.startsWith(r + "/"));
}

/** Si esta cuenta puede abrir esta ruta, o hay que mandarla a `homeFor`. */
export function routeAllowed(pathname: string, user: MaybeUser): boolean {
  if (isEmployee(user)) return under(pathname, EMPLOYEE_ROUTES);
  return isBusiness(user)
    ? !under(pathname, HOUSEHOLD_ONLY_ROUTES)
    : !under(pathname, BUSINESS_ONLY_ROUTES);
}

/** Cómo se llama cada rol en pantalla. */
export function roleLabel(user: MaybeUser, role: string): string {
  const labels: Record<string, string> = isBusiness(user)
    ? { admin: "Dueño", member: "Socio", employee: "Empleado" }
    : { admin: "Admin", member: "Miembro" };
  return labels[role] ?? role;
}

/**
 * Las palabras que cambian entre un hogar y un negocio. Sólo las de pantallas
 * que ven los dos: las pantallas exclusivas de cada uno ya hablan como tienen
 * que hablar.
 */
const TERMS = {
  household: { space: "hogar", Space: "Hogar", yourSpace: "tu hogar", YourSpace: "Tu hogar", spaceCode: "Código del hogar" },
  business: { space: "negocio", Space: "Negocio", yourSpace: "tu negocio", YourSpace: "Tu negocio", spaceCode: "Código del negocio" },
} as const;

export function terms(user: MaybeUser) {
  return TERMS[tenantKind(user)];
}
