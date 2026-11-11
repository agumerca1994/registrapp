import type { Metadata, Viewport } from "next";
import { DM_Mono, Figtree, Instrument_Serif, Urbanist } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";

const urbanist = Urbanist({
  subsets: ["latin"],
  variable: "--font-urbanist",
  display: "swap",
});

// Urbanist no tiene cifras de ancho fijo (un 1 mide la mitad que un 8) y los
// montos se comparan en columna. Figtree va sólo en `tabular-nums` (globals.css).
const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  variable: "--font-instrument-serif",
  display: "swap",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "tood",
  description: "Las cuentas de tu casa y de tu negocio: ingresos, gastos, tarjetas, dólares y ventas.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "tood",
  },
};

export const viewport: Viewport = {
  themeColor: "#5B4FE9",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${urbanist.variable} ${figtree.variable} ${instrumentSerif.variable} ${dmMono.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
