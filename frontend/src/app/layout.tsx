import type { Metadata } from "next";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import Header from "@/components/Header";
import AuthProviderWrapper from "@/components/AuthProviderWrapper";
import { ToastProvider } from "@/contexts/ToastContext";
import ToastContainer from "@/components/ToastContainer";
import HelpChatDock from "@/components/chatbot/HelpChatDock";
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
             * CATA-BOT, once, for every surface — public and authenticated.
             * `/api/chatbot` is public, and the questions it answers are asked
             * most often by people who have no account yet, so the assistant
             * cannot live behind the sidebar.
             *
             * This is deliberately NOT the floating action button that was
             * removed from here: `HelpChatDock` measures what is under its
             * corner and yields to it — see its own note. It is mounted inside
             * `AuthProviderWrapper` because the quick replies are role-scoped,
             * and after `<main>` so a keyboard user reaches the page before
             * the launcher.
             *
             * Every inline trigger still exists and opens THIS panel: the
             * sidebar's "Ayuda y soporte", "Contactar al club" on
             * /unauthorized, and `HelpChatLauncher` in the landing's contact
             * block, in `AuthShell`'s small print and in the enrolment header.
             */}
            <HelpChatDock />
          </AuthProviderWrapper>
        </ToastProvider>
      </body>
    </html>
  );
}
