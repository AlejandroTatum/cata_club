import type { Metadata } from "next";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import Header from "@/components/Header";
import AuthProviderWrapper from "@/components/AuthProviderWrapper";
import { ToastProvider } from "@/contexts/ToastContext";
import ToastContainer from "@/components/ToastContainer";
import "./globals.css";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Cata Club Admin";

interface RootLayoutProps {
  children: React.ReactNode;
}

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}`,
  },
  description:
    "Cata Club — Sistema de administración del club de Tenis de Mesa. Gestión de membresías, pagos, horarios y reservas de canchas.",
  icons: {
    icon: "/brand/cata-club-logo.jpeg",
  },
};

export default function RootLayout({
  children,
}: RootLayoutProps): React.ReactElement {
  return (
    <html lang="es">
      <body className="min-h-screen bg-cata-bg font-sans text-cata-text antialiased">
        <ToastProvider>
          <ToastContainer />
          <AuthProviderWrapper>
            <Header hideOnLanding />
            <main className="app-main mx-auto max-w-8xl px-4 py-10 sm:px-8 lg:px-12">
              {children}
            </main>
            {/*
             * No ChatWidget here on purpose. It used to be mounted globally
             * and carried its own floating action button, so the FAB sat over
             * the login form, over the landing's WhatsApp block and over the
             * trainer's attendance controls. It now lives inside `AppShell`,
             * opened from the sidebar's "Ayuda y soporte" entry.
             */}
          </AuthProviderWrapper>
        </ToastProvider>
      </body>
    </html>
  );
}
