"use client";

import { useEffect, useState } from "react";
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
import HeroCarousel from "./HeroCarousel";
import LandingMap from "./LandingMap";
import LandingMotionLoader from "./LandingMotionLoader";
import ScheduleSelector from "./ScheduleSelector";
import HelpChatLauncher from "@/components/chatbot/HelpChatLauncher";
import { buildLandingStats, landingConfig, toWhatsAppLink } from "./landing-config";
import { GALLERY_PHOTOS, slideSizes } from "./landing-gallery";
import { fetchSponsors, type Sponsor } from "@/services/api";

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
        <Image src="/landing/cata-club-logo.jpeg" alt="" width={62} height={62} />
        <span className="landing-display"><small>TENIS DE MESA</small>Cata Club</span>
      </a>
      <div className="landing-nav-links">
        <a className="active" href="#inicio" aria-current="page">Inicio</a>
        <a href="#nosotros">Nosotros</a>
        <a href="#galeria">Galería</a>
        <a href="#contacto">Soporte</a>
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
      <div className="landing-hero-copy">
        <span className="landing-hero-brand"><b>Tenis de Mesa</b> · Cata Club</span>
        <h1 className="landing-display" data-split>FORMANDO <span>CAMPEONES</span> PARA LA VIDA</h1>
        <p>Únete a nuestro club, donde la técnica y el carácter forjan en cada punto.</p>
        <div className="landing-hero-actions">
          <Link className="landing-button" href={ENROLL_HREF}>Inscríbete <ArrowRight aria-hidden="true" /></Link>
          <a className="landing-button landing-button-outline" href="#horarios">Ver horarios</a>
        </div>
        <div className="landing-hero-note"><Stars /><span>Club deportivo formativo · Fundado en 2013</span></div>
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
          <span className="landing-index" aria-hidden="true">01</span>
          <span className="landing-index-label" aria-hidden="true">Propósito</span>
          <h3>Nuestra Misión</h3>
          {/* Drawn in by the motion layer; the only movement in the block, so
              it reads as emphasis rather than decoration. */}
          <span className="landing-rule" aria-hidden="true" data-rule />
          <p className="landing-lead">Promover el tenis de mesa mediante formación deportiva de calidad.</p>
          <p>Fomentamos el desarrollo integral de niños, jóvenes y adultos con valores, disciplina y excelencia competitiva.</p>
        </article>
        <article className="landing-editorial-item" data-reveal>
          <span className="landing-index" aria-hidden="true">02</span>
          <span className="landing-index-label" aria-hidden="true">Horizonte</span>
          <h3>Nuestra Visión</h3>
          <span className="landing-rule" aria-hidden="true" data-rule />
          <p className="landing-lead">Ser un club líder y referente provincial y nacional.</p>
          <p>Preparamos deportistas altamente competitivos que integren de manera permanente las selecciones del país.</p>
        </article>
      </div>
    </section>
  );
}

function ValueCard({ index, title, children }: ValueCardProps): React.ReactElement {
  return (
    <article className="landing-value" data-reveal data-value>
      <span className="landing-value-rule" aria-hidden="true" data-rule />
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
    <section className="landing-section landing-motto" aria-label="Únete al club" data-motion-section data-testid="motion-section">
      <span className="landing-halftone" aria-hidden="true" />
      <span className="landing-paddle" aria-hidden="true"><i /></span>
      <p className="landing-motto-lead">Cada entrenamiento es una oportunidad para superarte.</p>
      <Link className="landing-button" href={ENROLL_HREF}>Inscríbete ahora <ArrowRight aria-hidden="true" /></Link>
      <Stars />
    </section>
  );
}

/**
 * Ships as a plain overflow-scrolling strip. The motion layer upgrades it to a
 * seamless drag-and-inertia loop by adding `is-enhanced`, so the gallery is
 * fully usable before that script runs, if it never runs, and when the visitor
 * prefers reduced motion.
 */
function Gallery(): React.ReactElement {
  return (
    <section className="landing-section landing-gallery" id="galeria" data-motion-section data-testid="motion-section">
      <SectionHeader eyebrow="Nuestra academia" title="Galería" />
      <div className="landing-carousel-wrap">
        <div className="landing-carousel" data-carousel role="group" aria-label="Galería de fotos del club">
          {GALLERY_PHOTOS.map((photo): React.ReactElement => (
            <figure className="landing-slide" key={photo.src}>
              <Image
                src={photo.src}
                alt={photo.alt}
                width={photo.width}
                height={photo.height}
                loading="lazy"
                quality={85}
                sizes={slideSizes(photo)}
                draggable={false}
              />
              <figcaption>{photo.caption}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function Schedule(): React.ReactElement {
  return (
    <section className="landing-section landing-schedule" id="horarios" data-motion-section data-testid="motion-section">
      {/* Master-detail selector: a client component, like the gallery's lightbox. */}
      <SectionHeader eyebrow="Entrenamientos" title="Elija una categoría" />
      <ScheduleSelector schedules={landingConfig.schedules} />
    </section>
  );
}

function Sponsors(): React.ReactElement | null {
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);

  useEffect(() => {
    void fetchSponsors().then(setSponsors).catch(() => setSponsors([]));
  }, []);

  if (sponsors.length === 0) return null;
  return (
    <section className="landing-section" aria-label="Patrocinadores" data-motion-section data-testid="motion-section">
      <SectionHeader eyebrow="Con el apoyo de" title="Patrocinadores" />
      <ul className="flex flex-wrap items-center gap-6 border-y border-white/20 py-8" aria-label="Logos de patrocinadores">
        {sponsors.map((sponsor): React.ReactElement => (
          <li key={sponsor.id} className="flex h-20 w-40 items-center justify-center bg-white p-3">
            {/* Remote Cloudinary delivery is public by product decision. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sponsor.logoUrl} alt={sponsor.nombre} className="max-h-full max-w-full object-contain" />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Location(): React.ReactElement {
  const { contact } = landingConfig;
  return (
    <section className="landing-section landing-location" id="contacto" data-motion-section data-testid="motion-section">
      <SectionHeader eyebrow="Visítanos" title="Ubicación" />
      <div className="landing-location-row">
        <LandingMap />
        <aside className="landing-contact" data-reveal>
          <h3>Información de contacto</h3>
          <p><MapPin aria-hidden="true" /><span>Av. Manuel Agustín Aguirre, Barrio Perpetuo Socorro, Loja, Ecuador — junto al Coliseo Ciudad de Loja</span></p>
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
          <p><CalendarDays aria-hidden="true" /><strong>Horario</strong><span>{contact.hours}</span></p>
          <a className="landing-button landing-button-outline" href="https://www.openstreetmap.org/?mlat=-4.0056095&mlon=-79.2046238#map=18/-4.0056095/-79.2046238" target="_blank" rel="noreferrer">
            <Navigation aria-hidden="true" /> Cómo llegar
          </a>
          {/*
           * The assistant — quiet, and ABOVE the WhatsApp CTA, which keeps
           * closing the card as the primary conversion. `POST /api/chatbot` is
           * public, and this is where the navbar's "Soporte" link already
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
          <div><span><Image src="/landing/cata-club-logo.jpeg" alt="" width={58} height={58} /></span><b className="landing-display"><small>TENIS DE MESA</small>Cata Club</b></div>
          <p>Formando campeones de tenis de mesa en Loja desde 2013.</p><Stars />
        </div>
        <nav aria-label="Servicios"><h2>Servicios</h2><a href="#horarios">Horarios y categorías</a><Link href={ENROLL_HREF}>Inscripciones</Link><a href="#contacto">Contacto</a></nav>
        <nav aria-label="Nosotros"><h2>Nosotros</h2><a href="#nosotros">Misión y Visión</a><a href="#valores">Valores</a><a href="#galeria">Galería</a><a href="#contacto">Ubicación</a></nav>
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
      {/*
       * The landmark opens at `Hero`, which is what `#inicio` — the skip link's
       * target — already points at, and closes before `Footer`. `Navbar` and
       * `Footer` stay outside it: they are the page's own banner and
       * contentinfo, and folding them into "principal" would make the skip link
       * land inside the region it exists to skip past.
       */}
      <main>
        <Hero /><Stats /><MissionVision /><Values /><Motto /><Gallery /><Schedule /><Sponsors /><Location />
      </main>
      <Footer />
    </div>
  );
}
