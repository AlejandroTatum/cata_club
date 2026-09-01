"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Facebook,
  Instagram,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  Star,
} from "lucide-react";
import Gallery from "./Gallery";
import HeroCarousel from "./HeroCarousel";
import LandingMap from "./LandingMap";
import LandingMotionLoader from "./LandingMotionLoader";
import NavScrollSpy from "./NavScrollSpy";
import Palmares from "./Palmares";
import ScheduleSelector from "./ScheduleSelector";
import Sponsors from "./Sponsors";
import Ticker from "./Ticker";
import HelpChatLauncher from "@/components/chatbot/HelpChatLauncher";
import { CLUB_PLUS_CODE, clubOpenStreetMapUrl } from "./club-location";
import { buildLandingStats, deriveContactHours, landingConfig, toWhatsAppLink } from "./landing-config";
import { EDITORIAL_MEDIA_SIZES, MAP_INSET_SIZES } from "./landing-image-sizes";
import { mapPublicSchedules, type LandingSchedule } from "./schedule-data";
import { SITE_NAV_SECTIONS, landingSectionHref } from "@/lib/site-navigation";

interface SectionHeaderProps {
  eyebrow: string;
  title: string;
}

interface ValueCardProps {
  index: string;
  title: string;
  children: React.ReactNode;
}

/**
 * Where every "inscríbete" affordance points.
 *
 * `/student/enroll` is the real public enrollment wizard: it POSTs to the
 * backend's public /enrollment, persists the student and auto-logs the user
 * in, and is listed in PUBLIC_EXCEPTIONS in src/lib/middleware-utils.ts.
 * The old `/register` demo placeholder stored nothing and has been removed.
 */
const ENROLL_HREF = "/student/enroll";

/**
 * The club crest, everywhere it appears on this page (navbar, hero paddle,
 * Motto paddle) — see issue #681. A real CI trace proved Next's built-in
 * `/_next/image` optimizer can get one specific request/cache-key stuck
 * forever (`status: -1`, no response, ever — confirmed across three separate
 * fresh page loads in the same server process), which no client-side retry
 * can outrun. The fix is not to survive that hang but to never trigger it:
 * this asset is served `unoptimized`, so no consumer ever asks the
 * optimizer for it, so the poisonable cache key never gets created.
 *
 * `cata-club-crest-256.png` is a pre-sized 256×256 derivative of the source
 * `cata-club-logo-avatar.png` (620×620, 340KB) — see the crest test lock in
 * `landing.spec.ts` for why 256 covers every rendered size on this page
 * (largest is the navbar at up to 84 CSS px) at up to ~3x density. 23.6KB
 * vs the source's 340KB: smaller than what the optimizer itself used to
 * hand back for the sizes this page actually rendered, without asking it
 * for anything at all.
 */
const CREST_SRC = "/brand/cata-club-crest-256.png";

/**
 * The published schedule catalog as this page sees it. `loading` is also what
 * server rendering produces, since the request below lives in an effect that
 * never runs there.
 */
type SchedulesState =
  | { kind: "loading" }
  | { kind: "ready"; schedules: LandingSchedule[] }
  | { kind: "empty" }
  | { kind: "error" };

/**
 * The landing's own status copy for the catalog. The schedule section and the
 * contact card's `Horario` row both read it from here, so a visitor is never
 * told two different things about the same missing data. There is no fourth
 * case: when the club has published nothing, the page says so — it does not
 * fall back to hours nobody confirmed.
 */
const SCHEDULE_STATUS: Record<Exclude<SchedulesState["kind"], "ready">, string> = {
  loading: "Cargando horarios…",
  empty: "Aún no hay horarios publicados.",
  error: "No se pudieron cargar los horarios.",
};

const SchedulesContext = createContext<SchedulesState>({ kind: "loading" });

/**
 * One request to `GET /api/schedules` for the whole page — issue #789.
 *
 * The club manages its schedules inside the app, so that catalog is the only
 * source of truth for them: the schedule section and the contact card's
 * opening hours are two views of one answer. Fetching it once per view would
 * give the same page two chances to disagree with itself, which is the
 * divergence this issue closed.
 *
 * It is provided through context rather than passed down from `LandingPage`
 * so that only the two views re-render when the answer arrives. `children` is
 * built by `LandingPage`, which never re-renders, so React skips the rest of
 * the tree — including `LandingMotionLoader`, whose runtime must load exactly
 * once.
 */
function PublicSchedules({ children }: { children: React.ReactNode }): React.ReactElement {
  const [state, setState] = useState<SchedulesState>({ kind: "loading" });

  useEffect((): (() => void) => {
    let cancelled = false;
    fetch("/api/schedules", { cache: "no-store" })
      .then((response): Promise<unknown> => {
        if (!response.ok) throw new Error("schedules unavailable");
        return response.json();
      })
      .then((payload: unknown): void => {
        if (cancelled) return;
        const schedules = mapPublicSchedules(payload);
        setState(schedules.length > 0 ? { kind: "ready", schedules } : { kind: "empty" });
      })
      .catch((): void => {
        if (!cancelled) setState({ kind: "error" });
      });
    return (): void => { cancelled = true; };
  }, []);

  return <SchedulesContext.Provider value={state}>{children}</SchedulesContext.Provider>;
}

function Stars(): React.ReactElement {
  return (
    <span className="landing-stars" aria-hidden="true">
      {[0, 1, 2].map((star): React.ReactElement => <Star key={star} fill="currentColor" />)}
    </span>
  );
}

/**
 * Left-aligned on purpose. A centred eyebrow above a centred rule above a
 * centred diamond is the arrangement every template ships with; an offset
 * baseline gives the eye a single edge to track down the page.
 */
function SectionHeader({ eyebrow, title }: SectionHeaderProps): React.ReactElement {
  return (
    <header className="landing-section-header" data-reveal>
      <span className="landing-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
    </header>
  );
}

function Navbar(): React.ReactElement {
  return (
    <nav className="landing-navbar" aria-label="Navegación principal">
      <a className="landing-logo" href="#inicio" aria-label="Cata Club, inicio">
        <Image src={CREST_SRC} alt="" width={84} height={84} unoptimized />
        <span className="landing-display"><small>TENIS DE MESA</small>Cata Club</span>
      </a>
      {/* The same list `components/Header.tsx` draws on every other page, from
          the same definition — see `lib/site-navigation.ts` for why the href is
          built here and not stored there. The first entry ships active because
          the page opens on it; `NavScrollSpy` takes over after hydration. */}
      <div className="landing-nav-links">
        {SITE_NAV_SECTIONS.map((section, index): React.ReactElement => (
          <a
            key={section.id}
            className={index === 0 ? "active" : undefined}
            href={landingSectionHref(section)}
            aria-current={index === 0 ? "page" : undefined}
          >
            {section.label}
          </a>
        ))}
      </div>
      {/* Deliberately quiet: existing members already know where to log in, so
          this must not compete with the hero's registration CTA. */}
      <Link className="landing-button-quiet landing-nav-cta" href="/login">
        ENTRAR <ArrowRight aria-hidden="true" />
      </Link>
    </nav>
  );
}

function Hero(): React.ReactElement {
  return (
    <header className="landing-hero" id="inicio" data-motion-section data-testid="motion-section">
      <span className="landing-halftone" aria-hidden="true" />
      <span className="landing-ribbon landing-ribbon-top" aria-hidden="true" />
      <span className="landing-hero-serve-ball" aria-hidden="true" data-serve-ball />
      {/* The paddle that produces that serve. It reuses `.landing-paddle` and
          `.landing-paddle-crest` — the exact shape and crest the Motto section
          renders — so the hero borrows the club's own mark instead of adding a
          second, generic one beside it. `landing.css` anchors the pair from a
          single origin so they cannot be positioned apart, and
          `landing-serve.ts` puts them on one timeline so they cannot fall out
          of phase. At rest — JS never loaded, or reduced motion — the ball
          standing square on the face IS the impact, so the still frame states
          the same thing the animation does. */}
      <span className="landing-paddle landing-hero-serve-paddle" aria-hidden="true" data-serve-paddle>
        {/* `unoptimized`, same asset and same reason as the navbar lockup
            above (see `CREST_SRC`) — no `/_next/image` request means no
            optimizer work to size at all, so 84 here is just the element's
            own box hint, not a srcset lever. */}
        <Image className="landing-paddle-crest" src={CREST_SRC} alt="" width={84} height={84} unoptimized />
        <i />
      </span>
      {/* No brand mark here. The navbar lockup sits directly above this copy
          and already names the club, so a second one only duplicated the
          identity and ate the vertical space the headline wants. `landing.css`
          hands that height back to the copy's own rhythm rather than leaving
          it as slack — see `.landing-hero-copy`'s gap. */}
      <div className="landing-hero-copy">
        <h1 className="landing-display" data-split>FORMANDO <span>CAMPEONES</span> PARA LA VIDA</h1>
        <p>Únete a nuestro club, donde la técnica y el carácter forjan en cada punto.</p>
        <div className="landing-hero-actions">
          <Link className="landing-button" href={ENROLL_HREF}>Inscríbete <ArrowRight aria-hidden="true" /></Link>
          <a className="landing-button landing-button-outline" href="#horarios">Ver horarios</a>
        </div>
        <div className="landing-hero-note"><Stars /><span>Club deportivo formativo · Desde 2013</span></div>
      </div>
      {/* 01/02/03 photo tab-carousel: a plain React state machine that stays
          fully usable without the GSAP motion layer. */}
      <HeroCarousel />
    </header>
  );
}

function Stats(): React.ReactElement {
  return (
    <section className="landing-stats" aria-label="Datos del club" data-motion-section data-testid="motion-section">
      {buildLandingStats().map((stat): React.ReactElement => (
        <div className="landing-stat" key={stat.label} data-reveal>
          {/* Text, never a count-up target: see buildLandingStats. */}
          <strong className="landing-display">{stat.value}</strong>
          <span>{stat.label}</span>
        </div>
      ))}
    </section>
  );
}

function MissionVision(): React.ReactElement {
  return (
    <section className="landing-section" id="nosotros" data-motion-section data-testid="motion-section">
      <SectionHeader eyebrow="Quiénes somos" title="Misión y Visión" />
      <div className="landing-editorial">
        <article className="landing-editorial-item" data-reveal>
          {/* Approved editorial photo: the community the club forms. Mission
              leads with the image (left); the copy follows (right). */}
          <figure className="landing-editorial-media">
            <Image
              src="/landing/photo-community.jpeg"
              alt="El club reúne a su comunidad en un entrenamiento"
              width={1200}
              height={900}
              loading="lazy"
              sizes={EDITORIAL_MEDIA_SIZES}
            />
          </figure>
          <div className="landing-editorial-copy">
            <span className="landing-index" aria-hidden="true">01</span>
            <span className="landing-index-label" aria-hidden="true">Propósito</span>
            <h3>Nuestra Misión</h3>
            {/* Drawn in by the motion layer; the only movement in the block, so
                it reads as emphasis rather than decoration. */}
            <span className="landing-rule" aria-hidden="true" data-rule />
            <p className="landing-lead">Promover el tenis de mesa mediante formación deportiva de calidad.</p>
            <p>Fomentamos el desarrollo integral de niños, jóvenes y adultos con valores, disciplina y excelencia competitiva.</p>
          </div>
        </article>
        <article className="landing-editorial-item" data-reveal>
          {/* Vision inverts the grid: copy leads (left), photo follows (right). */}
          <div className="landing-editorial-copy">
            <span className="landing-index" aria-hidden="true">02</span>
            <span className="landing-index-label" aria-hidden="true">Horizonte</span>
            <h3>Nuestra Visión</h3>
            <span className="landing-rule" aria-hidden="true" data-rule />
            <p className="landing-lead">Ser un club líder y referente provincial y nacional.</p>
            <p>Preparamos deportistas altamente competitivos que integren de manera permanente las selecciones del país.</p>
          </div>
          {/* Approved editorial photo: the squad heading for the selections. */}
          <figure className="landing-editorial-media">
            <Image
              src="/landing/vision-team-1329.jpg"
              alt="El equipo y entrenadores de Cata Club posan en el área de entrenamiento"
              width={1600}
              height={1200}
              loading="lazy"
              sizes={EDITORIAL_MEDIA_SIZES}
            />
          </figure>
        </article>
      </div>
    </section>
  );
}

/** Decorative guide stage animated by `playRally` in LandingMotion.tsx. */
    function Rally(): React.ReactElement {
      return <div className="landing-rally" data-rally aria-hidden="true"><svg viewBox="0 0 1200 190" preserveAspectRatio="none"><path className="landing-rally-guide" data-rally-guide d="M -60 170 Q 45 26 150 170 Q 300 26 450 170 Q 600 26 750 170 Q 900 26 1050 170 Q 1150 60 1270 170" /></svg><span className="landing-rally-ball" data-rally-ball /><span className="landing-rally-impact" data-rally-impact /><span className="landing-rally-count">RALLY <b data-rally-counter>0</b>/4</span></div>;
    }

    function ValueCard({ index, title, children }: ValueCardProps): React.ReactElement {
  return (
    <article className="landing-value" data-value>
      <span className="landing-value-rule" aria-hidden="true" />
      <span className="landing-index" aria-hidden="true">{index}</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </article>
  );
}

function Values(): React.ReactElement {
  return (
    <section className="landing-section landing-values" id="valores" data-motion-section data-testid="motion-section">
      <SectionHeader eyebrow="Lo que nos mueve" title="Nuestros Valores" />
      <Rally />
      <div className="landing-value-row">
        <ValueCard index="01" title="Respeto">Honramos a rivales, compañeros y entrenadores en cada encuentro.</ValueCard>
        <ValueCard index="02" title="Disciplina">El progreso nace de la constancia y el entrenamiento diario.</ValueCard>
        <ValueCard index="03" title="Esfuerzo">Cada punto se gana con entrega y dedicación total.</ValueCard>
        <ValueCard index="04" title="Compañerismo">Crecemos como una familia, celebrando juntos cada logro.</ValueCard>
      </div>
    </section>
  );
}

function Motto(): React.ReactElement {
  return (
    <section className="landing-section landing-motto" aria-label="Únete al club" data-motion-section data-motto data-testid="motion-section">
      <span className="landing-halftone" aria-hidden="true" />
      <span className="landing-paddle" data-motto-paddle aria-hidden="true">
        <Image className="landing-paddle-crest" src={CREST_SRC} alt="" width={62} height={62} unoptimized />
        <i />
      </span>
      <p className="landing-motto-lead" data-motto-copy>Cada entrenamiento es una oportunidad para superarte.</p>
      <Link className="landing-button" data-motto-cta href={ENROLL_HREF}>Inscríbete ya <ArrowRight aria-hidden="true" /></Link>
      <Stars />
    </section>
  );
}

function Schedule(): React.ReactElement {
  const state = useContext(SchedulesContext);

  return (
    <section className="landing-section landing-schedule" id="horarios" data-motion-section data-testid="motion-section">
      <SectionHeader eyebrow="Entrenamientos" title="Elija una categoría" />
      {state.kind === "ready"
        ? <ScheduleSelector schedules={state.schedules} />
        : <p className="landing-schedule-status" role="status">{SCHEDULE_STATUS[state.kind]}</p>}
    </section>
  );
}

function Location(): React.ReactElement {
  const { contact } = landingConfig;
  const state = useContext(SchedulesContext);
  /**
   * Derived from the very catalog the schedule section above renders (#789),
   * never from a second range maintained by hand. Until it arrives — and if it
   * never does: nothing published, the request failed, or JavaScript never ran
   * at all — the row says which of those happened, in the same words the
   * section uses. It never guesses a window.
   */
  const settled = state.kind === "ready";
  const hours = settled ? deriveContactHours(state.schedules) : SCHEDULE_STATUS[state.kind];
  return (
    <section className="landing-section landing-location" id="contacto" data-motion-section data-testid="motion-section">
      <SectionHeader eyebrow="Visítanos" title="Cómo llegar" />
      <div className="landing-location-row">
        <div className="landing-map-stage">
          <LandingMap />
          {/* A small, real view of the club grounds the map without pretending
              it is a street-facing photograph. It remains non-interactive so
              Leaflet's map and controls retain their expected behavior. */}
          <figure className="landing-map-inset">
            <Image
              src="/landing/photo-arrival.jpeg"
              alt="Entrada de Cata Club junto al Coliseo Ciudad de Loja"
              width={1600}
              height={1200}
              loading="lazy"
              sizes={MAP_INSET_SIZES}
            />
            <figcaption>Así se ve al llegar</figcaption>
          </figure>
        </div>
        <aside className="landing-contact" data-reveal>
          <h3>Información de contacto</h3>
          {/* Street address, landmark, and Plus Code, in that order: the way a
              visitor narrows down a place. The Coliseo stays — it is the
              reference the product owner gives, and #641 resolved to the club
              being beside it, not near a plaza. The Plus Code closes the last
              gap, since the street here carries no number. */}
          <p><MapPin aria-hidden="true" /><span>Av. Manuel Agustín Aguirre, Barrio Perpetuo Socorro, Loja, Ecuador — junto al Coliseo Ciudad de Loja ({CLUB_PLUS_CODE})</span></p>
          <p>
            <Phone className="landing-icon-whatsapp" aria-hidden="true" /><strong>WhatsApp</strong>
            <span className="landing-contact-numbers">
              {contact.whatsapp.map((number): React.ReactElement => (
                <a key={number} href={toWhatsAppLink(number)} target="_blank" rel="noreferrer">{number}</a>
              ))}
            </span>
          </p>
          <p><Facebook className="landing-icon-facebook" aria-hidden="true" /><strong>Facebook</strong><a href={contact.facebook} target="_blank" rel="noreferrer">Cata Club Loja</a></p>
          <p><Instagram className="landing-icon-instagram" aria-hidden="true" /><strong>Instagram</strong><a href={contact.instagram} target="_blank" rel="noreferrer">@cataclub_tenis_de_mesa</a></p>
          {/* A live region only while it is unsettled, so the visitor hears
              what happened; once it states real hours it is ordinary copy. */}
          <p role={settled ? undefined : "status"}><CalendarDays aria-hidden="true" /><strong>Horario</strong><span>{hours}</span></p>
          <a className="landing-button landing-button-outline" href={clubOpenStreetMapUrl()} target="_blank" rel="noreferrer">
            <Navigation aria-hidden="true" /> Cómo llegar
          </a>
          {/*
           * The assistant — quiet, and ABOVE the WhatsApp CTA, which keeps
           * closing the card as the primary conversion. `POST /api/chatbot` is
           * public, and this is where the navbar's "Contacto" link already
           * points, so a visitor with a question finds both options at once:
           * the bot for "¿cuáles son los horarios?", a real person for
           * everything else. No floating button — the one that used to hover
           * here covered this very block.
           */}
          <HelpChatLauncher variant="landing" label="Pregunta al asistente" />
          <a className="landing-button landing-button-block" href={toWhatsAppLink(contact.whatsapp[0])} target="_blank" rel="noreferrer">
            <MessageCircle aria-hidden="true" /> Escríbenos por WhatsApp
          </a>
        </aside>
      </div>
    </section>
  );
}

function Footer(): React.ReactElement {
  return (
    <footer className="landing-footer" data-motion-section data-testid="motion-section">
      <span className="landing-halftone" aria-hidden="true" />
      <div className="landing-footer-top">
        <div className="landing-footer-brand">
          {/* `unoptimized`, same reason as `CREST_SRC` above — see issue #710.
              PR #692 took the five crest consumers off `/_next/image` to keep
              issue #681's poisonable cache key from ever being created, but
              the footer lockup is a different asset and was missed: it still
              asked for `w=64`/`w=128` of the 1080x996 source. Both returned
              200 when measured, so this was exposure rather than an observed
              hang — and exposure to a bug whose blast radius is the whole Node
              process is not worth carrying for a 52px mark.
              `cata-club-logo-176.jpeg` is a pre-sized 176x162 derivative
              (7.6KB): CSS renders this at 52 CSS px, so 176 covers it at 3.4x
              density, more headroom proportionally than the crest's 256 gives
              its own largest consumer. `width`/`height` stay at 58 so the
              element's aspect ratio — and therefore the rendered box — is
              exactly what it was before. */}
          <div><span><Image src="/brand/cata-club-logo-176.jpeg" alt="" width={58} height={58} unoptimized /></span><b className="landing-display"><small>TENIS DE MESA</small>Cata Club</b></div>
          <p>Formando campeones de tenis de mesa en Loja desde 2013.</p><Stars />
        </div>
        <nav aria-label="Servicios"><h2>Servicios</h2><a href="#horarios">Horarios y categorías</a><Link href={ENROLL_HREF}>Inscripciones</Link><a href="#contacto">Contacto</a></nav>
        <nav aria-label="Nosotros"><h2>Nosotros</h2><a href="#nosotros">Misión y Visión</a><a href="#valores">Valores</a><a href="#galeria">Galería</a><a href="#contacto">Ubicación</a></nav>
        <nav aria-label="Información legal"><h2>Información legal</h2><Link href="/terminos">Términos de uso</Link><Link href="/privacidad">Aviso de privacidad</Link><Link href="/permiso-imagen-fetm">Permiso público de imagen FETM</Link></nav>
      </div>
      <div className="landing-footer-bottom">© {new Date().getFullYear()} Cata Club · Tenis de Mesa. Todos los derechos reservados.</div>
    </footer>
  );
}

export default function LandingPage(): React.ReactElement {
  return (
    <div className="landing-page">
      <a className="landing-skip-link" href="#inicio">Saltar al contenido</a>
      <LandingMotionLoader />
      <Navbar />
      <NavScrollSpy />
      {/*
       * The landmark opens at `Hero`, which is what `#inicio` — the skip link's
       * target — already points at, and closes before `Footer`. `Navbar` and
       * `Footer` stay outside it: they are the page's own banner and
       * contentinfo, and folding them into "principal" would make the skip link
       * land inside the region it exists to skip past.
       */}
      {/* `Schedule` and `Location` are the two views of the published catalog
          (#789); the provider fetches it once and renders no DOM of its own,
          so the landmark structure below is exactly what it was. */}
      <PublicSchedules>
        <main>
          <Hero /><Ticker /><Stats /><Schedule /><MissionVision /><Values /><Palmares /><Motto /><Gallery /><Location />
        </main>
      </PublicSchedules>
      {/* The sponsor strip sits between the page's main landmark and the footer:
          it is neither primary content nor site chrome. */}
      <Sponsors />
      <Footer />
    </div>
  );
}
