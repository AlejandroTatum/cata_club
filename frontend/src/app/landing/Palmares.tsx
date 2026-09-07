import Image from "next/image";
import {
  LOGRO_DESTACADO,
  logroPhotoSrc,
  MAS_PODIOS,
  PODIO_DIMENSIONS,
} from "./landing-logros";

interface LogroFactProps {
  label: string;
  value: string;
}

/** One dt/dd pair of the feature's fact sheet. `Año` and `Resultado` are the
 * only two facts that ever call this with an empty `value` filtered out
 * upstream — see `Palmares`'s conditional rendering below. */
function LogroFact({ label, value }: LogroFactProps): React.ReactElement {
  return (
    <div className="landing-logro-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * Logros. A server component — the retired demo toggle was the only reason
 * this needed client state, and it is gone. The section now tells the
 * club's one documented, out-of-country result as a short story with a fact
 * sheet (approved prototype `landing-logros-d-historia.html`, issue #657's
 * follow-up), instead of a five-row placeholder trophy wall.
 *
 * `Año` and `Resultado` render only when the club has actually supplied
 * them — see `LOGRO_DESTACADO` in `landing-logros.ts`. They are empty today,
 * so neither fact renders; never fill them with a placeholder value.
 */
export default function Palmares(): React.ReactElement {
  return (
    <section className="landing-section landing-wins" id="logros" data-motion-section data-testid="motion-section">
      <header className="landing-section-header" data-reveal>
        <span className="landing-eyebrow">Nuestra vitrina</span>
        <h2>Logros</h2>
      </header>

      <article className="landing-logro" data-reveal>
        <figure className="landing-logro-photo">
          <Image
            src={logroPhotoSrc(LOGRO_DESTACADO.photo)}
            alt=""
            width={934}
            height={1000}
            sizes="(max-width: 768px) 100vw, 34vw"
            loading="lazy"
          />
          <span className="landing-logro-index" aria-hidden="true">01</span>
        </figure>

        <div className="landing-logro-story">
          <p className="landing-logro-kicker">{LOGRO_DESTACADO.kicker}</p>
          <h3 className="landing-logro-title">
            <span>Sudamericano</span>
            <br />
            <span>Sub-11 y Sub-13</span>
          </h3>
          <p>{LOGRO_DESTACADO.story}</p>
          <dl className="landing-logro-facts">
            <LogroFact label="Competencia" value={LOGRO_DESTACADO.event} />
            <LogroFact label="Sede" value={LOGRO_DESTACADO.venue} />
            <LogroFact label="Representación" value={LOGRO_DESTACADO.representation} />
            <LogroFact label="Categorías" value={LOGRO_DESTACADO.categories} />
            {LOGRO_DESTACADO.year !== "" && <LogroFact label="Año" value={LOGRO_DESTACADO.year} />}
            {LOGRO_DESTACADO.result !== "" && <LogroFact label="Resultado" value={LOGRO_DESTACADO.result} />}
          </dl>
        </div>
      </article>

      <div className="landing-podios-block" data-reveal>
        <p className="landing-podios-label">
          <span>Más podios del club</span>
        </p>
        <ul className="landing-podios">
          {MAS_PODIOS.map((photo, index): React.ReactElement => {
            const dimensions = PODIO_DIMENSIONS[photo];
            return (
              <li key={photo}>
                <Image
                  src={logroPhotoSrc(photo)}
                  alt=""
                  width={dimensions.width}
                  height={dimensions.height}
                  sizes="(max-width: 768px) 50vw, 25vw"
                  loading="lazy"
                />
                <span className="landing-podios-index" aria-hidden="true">
                  {String(index + 2).padStart(2, "0")}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
