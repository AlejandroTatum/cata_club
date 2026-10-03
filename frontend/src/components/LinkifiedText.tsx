/**
 * Renders a plain sentence with any `https://` address in it as a real link.
 *
 * The user-facing error copy (`lib/error-message.ts`) offers the club's
 * WhatsApp as a bare URL inside a string, because strings are all `toUserMessage`
 * returns. Shown as text it cannot be clicked; this turns it into an anchor
 * without giving the message itself any markup.
 */
import type { ReactElement } from "react";
/** Inherits the surrounding size and colour: it sits inside alerts, not on a card. */
const LINK_CLASSES = "break-all font-semibold underline underline-offset-2";
const URL_PATTERN = /(https?:\/\/[^\s]+)/g;
/** Sentence punctuation that follows an address without belonging to it. */
const TRAILING_PUNCTUATION = /[.,;:!?)]+$/;

export default function LinkifiedText({ text }: { text: string }): ReactElement {
  const parts = text.split(URL_PATTERN);
  return (
    <>
      {parts.map((part, index) => {
        // `split` with a capture group puts the matches at the odd indexes.
        if (index % 2 === 0) return part;
        const trailing = part.match(TRAILING_PUNCTUATION)?.[0] ?? "";
        const href = trailing ? part.slice(0, -trailing.length) : part;
        return (
          <span key={index}>
            <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASSES}>
              {href}
            </a>
            {trailing}
          </span>
        );
      })}
    </>
  );
}
