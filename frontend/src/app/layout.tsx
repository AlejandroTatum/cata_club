import type { Metadata } from "next";
import { fontVariables } from "@/lib/fonts";
import Header from "@/components/Header";
import AuthProviderWrapper from "@/components/AuthProviderWrapper";
import { ToastProvider } from "@/contexts/ToastContext";
import ToastContainer from "@/components/ToastContainer";
import "./globals.css";

// The strict Content-Security-Policy (issue #1069, phase 3) is generated
// per request with a fresh nonce in src/middleware.ts. Next.js only stamps
// that nonce onto its injected scripts for DYNAMICALLY rendered documents —
// prerendered HTML is served from the build cache untouched (observed:
// every route was static and 0 of 25 scripts carried the nonce). This forces
// every document through dynamic rendering so the nonce plumbing works; the
// pages are thin client-fetching shells, so the rendering cost is minimal.
export const dynamic = "force-dynamic";

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
          </AuthProviderWrapper>
        </ToastProvider>
      </body>
    </html>
  );
}
