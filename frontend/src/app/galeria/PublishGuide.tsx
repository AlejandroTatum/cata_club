import type { ReactElement } from "react";
import InfoPanel from "@/components/ui/InfoPanel";
import { MAX_IMAGE_BYTES } from "./uploadError";

const MAX_IMAGE_MB = MAX_IMAGE_BYTES / (1024 * 1024);

interface Rule {
  term: string;
  detail: string;
}

interface PublishGuideProps {
  /** Heading of the card; always starts with "Cómo". */
  title: string;
  /** Rules specific to the screen: where it shows up, order, what deleting does. */
  rules: Rule[];
  /** Layout classes for the card, e.g. its order in the page rail. */
  className?: string;
}

/**
 * Always-visible indications card of the site-content rails (gallery and
 * sponsors): where the upload appears on the landing, the file limits taken
 * from the same constant the validation uses, order, visibility and deleting.
 */
export default function PublishGuide({ title, rules, className }: PublishGuideProps): ReactElement {
  const all: Rule[] = [
    ...rules.slice(0, 1),
    { term: "Formato y tamaño", detail: `JPG o PNG, hasta ${MAX_IMAGE_MB} MB.` },
    ...rules.slice(1),
  ];
  return <InfoPanel title={title} className={className}>
    <dl className="grid gap-2">
      {all.map((rule) => <div key={rule.term}>
        <dt className="font-semibold text-ink">{rule.term}</dt>
        <dd>{rule.detail}</dd>
      </div>)}
    </dl>
  </InfoPanel>;
}
