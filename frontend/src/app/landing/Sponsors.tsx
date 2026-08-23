import Image from "next/image";
import { SPONSOR_PLACEHOLDER_COUNT, SPONSORS } from "./landing-sponsors";

/**
 * An honest, progressively enhanced sponsor marquee. The visual strip repeats
 * exactly once for a seamless CSS loop; the duplicate is hidden from assistive
 * technology while pending slots retain one explicit accessible status.
 */
export default function Sponsors(): React.ReactElement {
  const hasSponsors = SPONSORS.length > 0;
  const accessibleStatus = hasSponsors
    ? `Auspiciantes: ${SPONSORS.map((sponsor): string => sponsor.name).join(", ")}.`
    : "Auspiciantes pendientes de confirmación.";

  const renderSlots = (duplicate: boolean): React.ReactElement[] => hasSponsors
    ? SPONSORS.map((sponsor): React.ReactElement => {
        const logo = <Image src={sponsor.logoSrc} alt="" width={156} height={60} />;
        return (
          <span className="landing-sponsors-item" key={`${sponsor.name}-${duplicate ? "duplicate" : "primary"}`}>
            {sponsor.href ? (
              <a
                className="landing-sponsor"
                href={sponsor.href}
                aria-label={sponsor.name}
                tabIndex={duplicate ? -1 : undefined}
                target="_blank"
                rel="noreferrer"
              >
                {logo}
              </a>
            ) : <span className="landing-sponsor" aria-label={sponsor.name}>{logo}</span>}
          </span>
        );
      })
    : Array.from({ length: SPONSOR_PLACEHOLDER_COUNT }, (_, index): React.ReactElement => (
        <span className="landing-sponsors-item" key={`${index}-${duplicate ? "duplicate" : "primary"}`}>
          <span className="landing-sponsor landing-sponsor-pending">
            <b>LOGO {String(index + 1).padStart(2, "0")}</b>
            <span>Pendiente</span>
          </span>
        </span>
      ));

  return (
    <section className="landing-sponsors" aria-label="Auspiciantes del club">
      <p className="landing-sponsors-head">Nos acompañan</p>
      <p className="sr-only">{accessibleStatus}</p>
      <div className="landing-sponsors-viewport">
        <div className="landing-sponsors-track" data-sponsors-track>
          <span className="landing-sponsors-copy" aria-hidden={hasSponsors ? undefined : true}>{renderSlots(false)}</span>
          <span className="landing-sponsors-copy" aria-hidden="true">{renderSlots(true)}</span>
        </div>
      </div>
    </section>
  );
}
