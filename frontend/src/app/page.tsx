import type { Metadata } from "next";
import localFont from "next/font/local";
import LandingPage from "./landing/LandingPage";
import "./landing/landing.css";

const barlow = localFont({
  src: [
    { path: "../../public/fonts/barlow-400.woff2", weight: "400" },
    { path: "../../public/fonts/barlow-500.woff2", weight: "500" },
    { path: "../../public/fonts/barlow-600.woff2", weight: "600" },
    { path: "../../public/fonts/barlow-700.woff2", weight: "700" },
    { path: "../../public/fonts/barlow-800.woff2", weight: "800" },
  ],
  variable: "--font-landing-barlow",
  display: "swap",
});

const graduate = localFont({ src: "../../public/fonts/graduate-400.woff2", variable: "--font-landing-graduate", display: "swap" });
const playfair = localFont({ src: "../../public/fonts/playfair-display-600.woff2", variable: "--font-landing-playfair", display: "swap" });

/**
 * The club's public landing — the link families actually share. `title.absolute`
 * is required: without it the root layout's `%s | Cata Club Admin` template
 * would brand the preview card as an internal admin panel.
 */
export const metadata: Metadata = {
  title: { absolute: "Cata Club — Tenis de Mesa en Loja" },
  description:
    "Club formativo de tenis de mesa en Loja, Ecuador. Entrenamientos para niños, jóvenes y adultos de lunes a sábado, junto al Coliseo Ciudad de Loja. Inscríbete o escríbenos por WhatsApp.",
  openGraph: {
    type: "website",
    locale: "es_EC",
    siteName: "Cata Club",
    title: "Cata Club — Tenis de Mesa en Loja",
    description:
      "Formando campeones para la vida desde 2013. Entrenamientos formativos, infantiles, juveniles, competitivos y para adultos en Loja, Ecuador.",
    /* Tracks the hero: the share card and the first thing a visitor sees on
       arrival should be the same photograph. Width and height must match the
       real file, or the preview card renders at the wrong ratio. */
    images: [
      {
        url: "/landing/hero-action.jpeg",
        width: 1440,
        height: 1200,
        alt: "Deportista de Cata Club ejecutando un saque durante un torneo",
      },
    ],
  },
};

export default function HomePage(): React.ReactElement {
  return <div className={`${barlow.variable} ${graduate.variable} ${playfair.variable}`}><LandingPage /></div>;
}
