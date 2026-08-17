import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Reserva de Notebooks",
  description:
    "Reserva e gestão de notebooks, maletas e carrinhos para instituições de ensino",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
