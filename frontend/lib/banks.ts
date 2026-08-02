// Curated list of Argentine banks/fintechs that issue cards. `domain` feeds
// the logo lookup (see components/ui/bank-logo.tsx); `color` is the brand
// color used for the card's gradient background and the initials-badge
// fallback when no logo loads. Not exhaustive — "Otro" in the card form
// covers anything not listed here (no logo, generic gradient).
export interface BankInfo {
  name: string;
  domain: string;
  color: string;
}

export const ARGENTINE_BANKS: BankInfo[] = [
  { name: "Banco Galicia", domain: "bancogalicia.com.ar", color: "#FF6600" },
  { name: "BBVA", domain: "bbva.com.ar", color: "#004481" },
  { name: "Santander", domain: "santander.com.ar", color: "#EC0000" },
  { name: "Banco Nación", domain: "bna.com.ar", color: "#003DA5" },
  { name: "Banco Provincia", domain: "bancoprovincia.com.ar", color: "#E30613" },
  { name: "Banco Ciudad", domain: "bancociudad.com.ar", color: "#FFD100" },
  { name: "Banco Macro", domain: "macro.com.ar", color: "#E4032E" },
  { name: "Banco Supervielle", domain: "supervielle.com.ar", color: "#00558C" },
  { name: "Banco Patagonia", domain: "bancopatagonia.com.ar", color: "#00A551" },
  { name: "HSBC", domain: "hsbc.com.ar", color: "#DB0011" },
  { name: "ICBC", domain: "icbc.com.ar", color: "#C7000B" },
  { name: "Banco Comafi", domain: "comafi.com.ar", color: "#7A1F2B" },
  { name: "Banco Credicoop", domain: "bancocredicoop.coop", color: "#00833E" },
  { name: "Banco Hipotecario", domain: "hipotecario.com.ar", color: "#003D6B" },
  { name: "Itaú", domain: "itau.com.ar", color: "#EC7000" },
  { name: "Banco Columbia", domain: "bancocolumbia.com.ar", color: "#5E2D91" },
  { name: "Banco del Sol", domain: "bancodelsol.com", color: "#F7941D" },
  { name: "Brubank", domain: "brubank.com", color: "#6C2EB5" },
  { name: "Ualá", domain: "uala.com.ar", color: "#1A1A2E" },
  { name: "Naranja X", domain: "naranjax.com", color: "#FF7A00" },
  { name: "Mercado Pago", domain: "mercadopago.com.ar", color: "#00B1EA" },
  { name: "Personal Pay", domain: "personalpay.com.ar", color: "#0033A0" },
  { name: "Wilobank", domain: "wilobank.com", color: "#00E6B0" },
  { name: "Rebanking", domain: "rebanking.com", color: "#8A2BE2" },
  { name: "Openbank", domain: "openbank.com.ar", color: "#FF1946" },
];

export function findBank(name: string): BankInfo | undefined {
  return ARGENTINE_BANKS.find((b) => b.name === name);
}
