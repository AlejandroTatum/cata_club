import Image from "next/image";
import { cn } from "@/components/ui/cn";

export interface LegalPhotoSource {
  src: string;
  alt: string;
  /** CSS object-position, to keep the faces in a crop. */
  position?: string;
}

/**
 * A club photograph as a card. It carries the page's imagery instead of blank
 * space: a rail that is shorter than the document ends on a picture, not on
 * an empty strip. The caller sizes it (aspect ratio, or the cell it fills);
 * `bare` drops the card surface when it sits inside a card of its own.
 */
export default function LegalPhoto({ photo, className, sizes, bare = false }: { photo: LegalPhotoSource; className?: string; sizes: string; bare?: boolean }): React.ReactElement {
  return (
    <figure className={cn("relative overflow-hidden", !bare && "card", className)}>
      <Image src={photo.src} alt={photo.alt} fill sizes={sizes} className="object-cover" style={{ objectPosition: photo.position ?? "50% 25%" }} />
    </figure>
  );
}
