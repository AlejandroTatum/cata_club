/**
 * The enrollment wizard's page frame: a full-height split.
 *
 * The wizard reaches the visitor through no shell, so a centred column left
 * both sides of a wide window empty. From `lg` the frame is a coal brand panel
 * on the left (the way out, the club, the title, the steps and the live summary)
 * and the step card centred in the area on the right. Below
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
  /** Wide only: the live summary, after the steps. */
  summary?: ReactNode;
  children: ReactNode;
}

export default function EnrollFrame(props: EnrollFrameProps): ReactElement {
  return (
    <div className="auth-shell flex min-h-screen w-full flex-col bg-canvas lg:flex-row">
      {/* From `lg` the panel is 384px wide with 40px of padding and its four
          blocks (brand row, title, steps, summary) stack in normal flow with a
          32px gap: no block is pinned to the bottom, so no gap grows with the
          step. The `data-enroll-*` hooks are what the geometry check measures. */}
      <header
        data-testid="enroll-brand-panel"
        data-enroll-panel
        className="flex flex-col gap-section bg-coal px-4 py-section text-white lg:sticky lg:top-0 lg:h-screen lg:w-96 lg:flex-none lg:gap-8 lg:overflow-y-auto lg:p-10"
      >
        <div data-enroll-panel-block className="flex items-center gap-section">
          <span className="relative block h-10 w-10 shrink-0 overflow-hidden rounded-full border-2 border-white/10">
            <Image
              src="/brand/cata-club-logo.jpeg"
              alt="Cata Club"
              fill
              sizes="40px"
              className="object-cover"
              priority
            />
          </span>
          {props.back}
        </div>

        <div data-enroll-panel-block>
          <p className="mb-field text-2xs font-bold uppercase text-white/75">
            {props.eyebrow}
          </p>
          <h1 className="font-display text-lg uppercase tracking-flat text-white lg:text-xl">
            {props.title}
          </h1>
          <p className="mt-1 text-sm text-white/75">{props.subtitle}</p>
        </div>

        {props.steps && <div data-enroll-panel-block>{props.steps}</div>}

        {props.summary && <div data-enroll-panel-block>{props.summary}</div>}
      </header>

      {/* The card sits centred in this area: equal side margins at any width,
          and the same 40px top as the panel's first block. */}
      <div
        data-enroll-main
        className="flex min-w-0 flex-1 flex-col gap-page px-4 py-page lg:p-10"
      >
        {props.children}
      </div>
    </div>
  );
}
