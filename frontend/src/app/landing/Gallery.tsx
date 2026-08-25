"use client";

import Image from "next/image";
import { GALLERY_PHOTOS, slideSizes } from "./landing-gallery";

/** Presentation-only gallery: motion is owned by LandingMotion on the strip. */
export default function Gallery(): React.ReactElement {
  return (
    <section className="landing-section landing-gallery" id="galeria" data-motion-section data-testid="motion-section">
      <header className="landing-section-header" data-reveal>
        <span className="landing-eyebrow">Nuestra academia</span>
        <h2>Galería</h2>
      </header>
      <div className="landing-carousel-wrap">
        <div className="landing-carousel" data-carousel role="group" aria-label="Galería de fotos del club">
          {GALLERY_PHOTOS.map((photo): React.ReactElement => (
            <figure className="landing-slide" key={photo.src} style={{ aspectRatio: `${photo.width} / ${photo.height}` }}>
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
