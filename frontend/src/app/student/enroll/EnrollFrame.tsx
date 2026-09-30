/**
 * The enrollment wizard's page frame: a full-height split.
 *
 * The wizard reaches the visitor through no shell, so a centred column left
 * both sides of a wide window empty. From `lg` the frame is a coal brand panel
 * pinned to the left (the way out, the club, the title, the steps and the live
 * summary) and the form on the right, left-aligned within its own area. Below
 * `lg` the panel collapses to a compact coal header and the form stacks under
 * it.
 *
 * `auth-shell` is the class `globals.css` keys the chrome-less layout off
 * (`.app-main:has(.auth-shell)` cancels the root wrapper's max width and
 * padding) — the same hook the login split uses, so the frame reaches both
 * edges of the window without a rule of its own.
 */

import type { ReactElement, ReactNode } from "react";
import Image from "next/image";

interface EnrollFrameProps {
  /** The way out — a `BackLink` in its coal tone, or a placeholder while the session loads. */
  back: ReactNode;
  /** "Paso N de M" — the one place the count is written out. */
  eyebrow: string;
  title: string;
  subtitle: string;
  /** Wide only: the vertical steps, under the title. */
  steps?: ReactNode;
  /** Wide only: the live summary, pinned to the bottom of the panel. */
  summary?: ReactNode;
  children: ReactNode;
}

export default function EnrollFrame(props: EnrollFrameProps): ReactElement {
  return (
    <div className="auth-shell flex min-h-screen w-full flex-col bg-canvas lg:flex-row">
      <header
        data-testid="enroll-brand-panel"
        className="flex flex-col gap-section bg-coal px-4 py-section text-white lg:sticky lg:top-0 lg:h-screen lg:w-5/12 lg:min-w-96 lg:max-w-3xl lg:flex-none lg:overflow-y-auto lg:px-12 lg:py-10"
      >
        <div className="flex w-full flex-1 flex-col gap-section lg:max-w-lg lg:gap-page">
          <div className="flex items-center justify-between gap-section">
            {props.back}
            <span className="relative block h-10 w-10 shrink-0 overflow-hidden rounded-full border-2 border-white/10 lg:h-14 lg:w-14 lg:border-4">
              <Image
                src="/brand/cata-club-logo.jpeg"
                alt="Cata Club"
                fill
                sizes="56px"
                className="object-cover"
                priority
              />
            </span>
          </div>

          <div>
            <p className="mb-field text-2xs font-bold uppercase text-white/75">{props.eyebrow}</p>
            <h1 className="font-display text-lg uppercase tracking-flat text-white lg:text-xl">
              {props.title}
            </h1>
            <p className="mt-1 text-sm text-white/75">{props.subtitle}</p>
          </div>

          {props.steps}

          {props.summary && <div className="mt-auto pt-page">{props.summary}</div>}
        </div>
      </header>

      <div className="min-w-0 flex-1">
        <div className="flex max-w-5xl flex-col gap-page px-4 py-page lg:px-12 lg:py-10">
          {props.children}
        </div>
      </div>
    </div>
  );
}
