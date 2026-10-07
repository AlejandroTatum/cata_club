"use client";

import { useContext } from "react";
import Link from "next/link";
import { ArrowRight, MessageCircle } from "lucide-react";
import { landingConfig, toWhatsAppLink } from "./landing-config";
import { TarifasContext, type TarifasState } from "./tarifas-context";

/**
 * The sections that take a family from "what is this" to "enrolled" (QA4
 * LAN-03/LAN-14): the plan prices, the three steps, a mini FAQ and the fixed
 * mobile bar. Everything here that names a price or a plan reads the app's
 * catalog; nothing is restated.
 */

/** Where every "inscríbase" affordance points (see `LandingPage`). */
export const ENROLL_HREF = "/student/enroll";

/** The wizard preselects its type from `?type=` (`student/enroll/page.tsx`). */
export const ENROLL_ADULT_HREF = `${ENROLL_HREF}?type=self`;
export const ENROLL_CHILD_HREF = `${ENROLL_HREF}?type=child`;

const PRICES_STATUS: Record<Exclude<TarifasState["kind"], "ready">, string> = {
  loading: "Cargando valores…",
  empty: "Los valores no están publicados todavía. Escríbenos por WhatsApp y te los indicamos.",
  error: "No se pudieron cargar los valores. Escríbenos por WhatsApp y te los indicamos.",
};

const STEPS = ["Elige la categoría", "Inscríbete en línea", "Listo para entrenar"] as const;

const FAQ: { question: string; answer: string }[] = [
  { question: "¿Cuánto cuesta?", answer: "Los valores vigentes de cada plan están en la sección Mensualidad, más arriba en esta página." },
  { question: "¿Qué debo llevar?", answer: "Escríbenos por WhatsApp y te indicamos qué llevar según la categoría." },
  { question: "¿Cómo es la primera clase?", answer: "Elige la categoría, inscríbete en línea y escríbenos por WhatsApp para consultar los cupos y coordinar tu primer día." },
];

function whatsAppHref(): string {
  return toWhatsAppLink(landingConfig.contact.whatsapp[0]);
}

export function Prices(): React.ReactElement {
  const state = useContext(TarifasContext);
  return (
    <section className="landing-section landing-prices" id="mensualidad" data-motion-section data-testid="motion-section">
      <header className="landing-section-header" data-reveal>
        <span className="landing-eyebrow">Valores</span>
        <h2>Mensualidad</h2>
      </header>
      {state.kind === "ready" ? (
        <ul className="landing-prices-list">
          {state.tarifas.map((tarifa): React.ReactElement => (
            <li key={tarifa.name} className="landing-price">
              <span className="landing-price-name">{tarifa.name}</span>
              <strong className="landing-price-amount">
                {tarifa.price}
                {tarifa.period && <span className="landing-price-period"> {tarifa.period}</span>}
              </strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="landing-schedule-status" role="status">{PRICES_STATUS[state.kind]}</p>
      )}
    </section>
  );
}

export function Steps(): React.ReactElement {
  return (
    <section className="landing-section landing-steps" id="como-empezar" data-motion-section data-testid="motion-section">
      <header className="landing-section-header" data-reveal>
        <span className="landing-eyebrow">Cómo empezar</span>
        <h2>Tres pasos</h2>
      </header>
      <ol className="landing-steps-list">
        {STEPS.map((step): React.ReactElement => <li key={step}>{step}</li>)}
      </ol>
      <div className="landing-steps-actions">
        <Link className="landing-button" href={ENROLL_ADULT_HREF}>Soy jugador adulto <ArrowRight aria-hidden="true" /></Link>
        <Link className="landing-button landing-button-outline" href={ENROLL_CHILD_HREF}>Inscribo a mi hijo <ArrowRight aria-hidden="true" /></Link>
      </div>
    </section>
  );
}

export function Faq(): React.ReactElement {
  return (
    <section className="landing-section landing-faq" id="preguntas" data-motion-section data-testid="motion-section">
      <header className="landing-section-header" data-reveal>
        <span className="landing-eyebrow">Antes de empezar</span>
        <h2>Preguntas frecuentes</h2>
      </header>
      <div className="landing-faq-list">
        {FAQ.map((item): React.ReactElement => (
          <details key={item.question}>
            <summary>{item.question}</summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/** Mobile only (CSS): the two actions a family wants within thumb reach. */
export function MobileBar(): React.ReactElement {
  return (
    <div className="landing-mobile-bar">
      <Link className="landing-button" href={ENROLL_HREF}>Inscríbete <ArrowRight aria-hidden="true" /></Link>
      <a className="landing-mobile-bar-whatsapp" href={whatsAppHref()} target="_blank" rel="noreferrer" aria-label="Escribir por WhatsApp">
        <MessageCircle aria-hidden="true" />
      </a>
    </div>
  );
}
