import type { Metadata } from "next";
import "./globals.css";
import { ServiceWorkerCleanup } from "@/components/ServiceWorkerCleanup";

export const metadata: Metadata = {
  title: "Concilia · Arkandev",
  description: "Verificación automática de transferencias para tu negocio.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased">
        <ServiceWorkerCleanup />
        {children}
      </body>
    </html>
  );
}
