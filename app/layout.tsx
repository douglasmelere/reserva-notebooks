import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: {
    default: "Reserva de Notebooks",
    template: "%s · Reserva de Notebooks",
  },
  description:
    "Reserva e gestão de notebooks, maletas e carrinhos para instituições de ensino.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.png", type: "image/png" },
    ],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  // Azul institucional: é a cor que o Android pinta na barra do navegador.
  themeColor: "#0f4194",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
