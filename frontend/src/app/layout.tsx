import type { Metadata } from "next";
import { fontVariables } from "@/lib/fonts";
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
  /*
   * The three brand families are mounted on `<html>` below, on the element
   * every route in the product inherits from, and not in the shells or pages.
   *
   * They used to arrive as four `@fontsource/inter` stylesheet imports on this
   * same file, which is why every authenticated screen rendered in Inter while
   * the landing rendered in the faces the club actually chose. Swapping those
   * imports for these variables is the whole migration: `font-sans` on `<body>`
   * already resolves through `tailwind.config.ts`, so the entire product
   * changes face without a single component being touched.
   *
   * `<html>` rather than `<body>`: a CSS custom property is only visible to the
   * subtree it is declared on, and anything Next renders outside `<body>` would
   * lose them one level down.
   *
   * `lib/fonts.ts` explains why the landing still declares its own
   * `--font-landing-*` copies of these same three files.
   */
  return (
    <html lang="es" className={fontVariables}>
      <body className="min-h-screen bg-cata-bg font-sans text-cata-text antialiased">
        <ToastProvider>
          <ToastContainer />
          <AuthProviderWrapper>
            <Header hideOnLanding />
            {/*
             * A `<div>`, deliberately, and NOT a `<main>`.
             *
             * This element wraps every page in the product, and every page
             * reaches the user through a shell that draws its own `<main>`
             * where its content actually starts. When this one was also a
             * landmark, each authenticated route shipped two regions called
             * "principal", one inside the other — and the skip link pointed at
             * the inner one, so the region a screen reader met first was not
             * the one the keyboard jump used.
             *
             * What it does carry is real and stays: the max width and padding
             * for the routes with no shell of their own. `globals.css:7-12`
             * cancels both for `.landing-page`, `.auth-shell` and `.app-shell`,
             * which is why those three never depended on this element for
             * anything but the tag it used to be.
             *
             * See `lib/__tests__/main-landmark.test.ts` for the closed set of
             * files allowed to declare the landmark.
             */}
            <div className="app-main mx-auto max-w-8xl px-4 py-10 sm:px-8 lg:px-12">
              {children}
            </div>
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
