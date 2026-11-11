import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        // La tinta de la acción principal: el + y los botones oscuros.
        ink: "#1C1B25",
      },
      // `border-ink` era el borde grueso oscuro de la versión anterior, y lo usan
      // más de 130 elementos. Ahora es el borde fino de toda la app, en un solo lugar.
      borderColor: {
        ink: "hsl(var(--border) / <alpha-value>)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-urbanist)", "system-ui", "sans-serif"],
        display: ["var(--font-urbanist)", "system-ui", "sans-serif"],
        // Sólo las fechas de "Lo que viene": el gesto propio de la pantalla.
        fecha: ["var(--font-instrument-serif)", "Georgia", "serif"],
        marca: ["var(--font-dm-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        // Lo único que se eleva es lo que flota sobre el contenido. La sombra
        // dura de los botones se fue: si todo sobresale, nada sobresale.
        hero: "0 8px 20px rgba(60, 50, 120, 0.06)",
        chip: "none",
        flota: "0 12px 30px rgba(40, 34, 80, 0.14)",
      },
    },
  },
  plugins: [],
};

export default config;
