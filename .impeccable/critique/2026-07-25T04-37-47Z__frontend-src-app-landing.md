---
target: landing (frontend/src/app/landing)
total_score: 20
max_score: 36
na_heuristics: 10
p0_count: 2
p1_count: 3
timestamp: 2026-07-25T04-37-47Z
slug: frontend-src-app-landing
---
Method: dual-agent (A: a75aaeedfae0c06bb design review · B: adb33d24c5bc3bc4c detector+browser)
Surface: Landing — `frontend/src/app/landing/` (served at `/` via `app/page.tsx`)
Mode: Persuade

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | `aria-current="page"` hardcoded on "Inicio" (LandingPage.tsx:83); no scroll-spy, no sticky nav |
| 2 | Match System / Real World | 3 | "Soporte" labels the contact section; sole CTA is "ENTRAR" (app language to non-users) |
| 3 | User Control and Freedom | 2 | Lenis hijacks wheel scroll (LandingMotion.tsx:16); no back-to-top on ~6000px page |
| 4 | Consistency and Standards | 2 | "ENTRAR" is red in nav, yellow in hero; "Cómo llegar" (external link) wears the primary style |
| 5 | Error Prevention | 2 | Phone numbers are unlinked `<span>` (LandingPage.tsx:246); Leaflet icons from unpkg.com with no fallback |
| 6 | Recognition Rather Than Recall | 2 | Parent must memorize a schedule slot and a 10-digit number across an app switch |
| 7 | Flexibility and Efficiency | 2 | Anchor nav omits `#horarios`, the highest-intent section (LandingPage.tsx:82-87) |
| 8 | Aesthetic and Minimalist Design | 3 | Strongest axis; undercut by Motto repeating the H1 verbatim and a footer duplicating the nav |
| 9 | Error Recovery | 2 | `LandingMap` has a loading state and no error state — blocked tiles = permanent grey rectangle |
| 10 | Help and Documentation | n/a | On a marketing page the help surface IS the contact block, already scored under H2/H6 |
| **Total** | | **20/36 (56%)** | **Acceptable** |

## Design Specificity Verdict

**Painted, not composed.** The surface language is authored; the composition is a stock template skeleton.

Genuinely authored: `.landing-ribbon` (landing.css:64) — a 440x190 half-ellipse with a 28px yellow bottom border and a stacked triple shadow rotated 27deg, reproducing screen-printed pennant ink. `.landing-paddle` (css:115-117) — a table-tennis paddle from a circle, a pip and a rotated pill, at zero asset weight. Graduate + #d92128/#ffd600 varsity pair.

Category-interchangeable: `.landing-hero-animation` / `.landing-hero-screen` (css:79-81) stages the club's team photo inside a device-mockup frame — the class is literally named `-screen`. The 4-up count-up stat band is the canonical SaaS trust bar. MissionVision + Values grids are a Bootstrap features section. `.landing-schedule-card` (css:127-131) is a pricing-tier card whose big number happens to be a time. 3-column footer. The `eyebrow → uppercase H2 → separator` rhythm repeats identically across 6 sections of wildly different intent.

The tell: all four `ValueCard`s render the same `Trophy` icon (LandingPage.tsx:168). The icon slot carries zero information; it exists because the template has an icon slot.

**Deterministic scan (Assessment B):** 3 raw detector findings on this surface → 1 true positive. `border-accent-on-rounded` at `landing.css:127` is real (`.landing-schedule-card`: 1px border + 5px top accent on a 16px radius). `border-accent-on-rounded` at `:64` is a false positive (`.landing-ribbon` is a decorative arc drawn via thick border on a 50%-radius box — the standard technique, `pointer-events: none`, no content inside). `broken-image` in `__tests__/LandingPage.test.tsx:12` is a `next/image` test double that never ships.

**Browser measurements:** `/` renders clean at 1440x900 and 390x844 — zero console errors, zero failed network requests, no horizontal overflow, zero contrast failures. Lowest measured ratio is 3.54 (`#ffd600` on `#d92128` at 48px/400), which passes large-text 3:1 but would fail at body size. 19 undersized touch targets at 390px: nav links compute to 40px tall despite `min-height: 44px` declared at `landing.css:56`; footer links are 240x24; Leaflet zoom controls 30x30; attribution links 14px tall.

`/landing` returns 404 — structural, not a deploy break: the directory holds only components, no `page.tsx`. Content is served at `/`.

No visual overlay was produced: the MCP browser runs in a separate filesystem namespace, so screenshots could not be retrieved. All findings above come from DOM/computed-style measurement.

## Overall Impression

The craft in the CSS is above average and the interaction scaffolding is below it. Someone hand-drew a pennant and a paddle in three CSS rules, quarantined third-party brand colors behind `--landing-third-party-*` tokens, and gated motion correctly at three independent layers — and then pointed the entire funnel at a login door.

Biggest opportunity: **the page has no path to enroll.** `/register` exists and is linked from `login/page.tsx:230`. The landing links to it zero times.

## What's Working

1. **Hand-drawn brand furniture.** `.landing-ribbon` and `.landing-paddle` encode the sport and the varsity idiom at zero asset weight, survive any viewport without an image request, and read correctly at 27deg rotation. A template could not have supplied these.
2. **Token architecture that resists contamination.** `landing.css:1-37` declares primitives, then a semantic layer (`--landing-action`, `--landing-on-action`, `--landing-focus`), and quarantines WhatsApp green and Facebook blue under `--landing-third-party-*`. The two colors most likely to wreck a palette are structurally marked as not-ours, so no future contributor reaches for `#25d366` as a success color.
3. **Motion gated at three layers.** `gsap.matchMedia` puts Lenis, reveals and counters behind `(prefers-reduced-motion: no-preference)` with a `reduce` branch that `clearProps`, plus a CSS belt-and-braces block, plus `immediateRender: false` on every reveal — which is the detail that matters: a ScrollTrigger that never fires leaves content visible instead of stuck at `opacity: 0`.

## Priority Issues

**[P0] No path to enroll.** The sole primary CTA is `ENTRAR → /login`, in both navbar (LandingPage.tsx:88-90) and hero (:105). The stated audience has no account; every converting visitor hits a login wall and must self-rescue by spotting a secondary link on the next page. Fix: hero yellow button becomes "Inscríbete" → `/register`; demote nav ENTRAR to an outline/text link so it stops competing chromatically. Suggested command: `/impeccable clarify`.

**[P0] WhatsApp numbers are dead text at the decision moment.** `LandingPage.tsx:246` renders `<span>{contact.whatsapp.join(" · ")}</span>` — two unlabeled 10-digit numbers behind a `Phone` icon deliberately colored WhatsApp-green. The design signals WhatsApp and refuses to open it. In Ecuador WhatsApp is the enrollment channel. Fix: `<a href="https://wa.me/593...">` per number with a name/role label; add a full-width "Escríbenos por WhatsApp" as the last element of `.landing-contact`; demote "Cómo llegar" to outline. Suggested command: `/impeccable clarify`.

**[P1] Zero CTA below the hero.** `.landing-navbar` (css:52) has no `position`, so across ~6000px every conversion affordance lives in the top 578px. Intent peaks at `#horarios` and `#contacto` — sections 8 and 9 — where the only thing to click is a map link that leaves the site. Fix: `position: sticky; top: 0; z-index: 50` on `.landing-navbar`, currently blocked by `.landing-page { overflow: hidden }` (css:34) → change to `overflow-x: clip`. Replace the Motto's duplicated headline with new copy plus a mid-page CTA. Suggested command: `/impeccable layout`.

**[P1] Landing metadata sells an admin panel.** `app/page.tsx` exports no `metadata`, so it inherits `layout.tsx:19-29`: title "Cata Club Admin", description "Sistema de administración del club…". No `openGraph`, no share image. In this market the club's link is shared into WhatsApp groups constantly and the preview card is the actual first impression. Fix: add `export const metadata` with a club-facing title, a parent-facing description naming ages and location, and `openGraph.images`. Suggested command: `/impeccable clarify`.

**[P1] The trust band contradicts itself.** `landing-config.ts:30-52`: stat 1 = "2013", stat 2 = "+12 Años" — in 2026 that is 13, hardcoded, decaying every January. Stats 2 and 3 carry `// TODO(client): Confirm` and are live. Stat 4 has no `numericValue`, so one of four doesn't animate. And the counter runs `0 → 2013` on an odometer, which reads as a bug. Fix: derive years from the founding year or delete the stat; resolve both TODOs before launch; drop `numericValue` from the year. Suggested command: `/impeccable harden`.

**[P2] The gallery discards the club's best credential.** `LandingPage.tsx:39-55`: `alt` names "the South American U11-U13 Table Tennis Championship in Asunción, Paraguay"; the visible `figcaption` says "Competencia internacional de tenis de mesa." The strongest fact the club owns is hidden in an attribute no sighted visitor reads. Fix: promote event + city + year into `figcaption`; keep `alt` as visual description. Suggested command: `/impeccable clarify`.

**[P2] Schedule row breaks between 769px and 1024px.** `.landing-schedule-row` (css:126) only goes column at ≤768px; the 1024 breakpoint wraps `.landing-value-row` but not this one. At ~900px five `flex: 1` cards share ~800px → ~150px each, each holding `strong { font-size: 30px }` with "15:00 – 16:00". Fix: `flex-wrap: wrap` + `flex-basis: calc(33.333% - 8px)` in the 1024 block; `clamp(20px, 2.4vw, 30px)` on `strong`. Suggested command: `/impeccable adapt`.

**[P3] Two WCAG contrast failures in brand-critical states.** `.landing-hero-brand b` (css:68) — `#ffd600` on `#d92128` at 15px/800 = 3.54:1, needs 4.5. `.landing-nav-links a:hover` (css:58) — `#e5397d` on white = 4.03:1. Fix: use `--landing-on-action` (white, 5.0:1) for the `b`; darken nav hover to ~`#c21f60`. Suggested command: `/impeccable audit`.

## Cognitive Load

4 of 8 items fail. Failures: **single focus** (ten sections at near-equal weight, no climax), **grouping** (footer "Servicios" groups four distinct labels that all resolve to `#horarios` — false grouping), **≤4 options** (schedule row shows 5 cards; `.landing-contact` presents 7 items at the decision moment; footer shows 8 links), **working memory** (schedule → contact → WhatsApp requires holding a time and then 10 digits across an app switch). Worst decision point: `.landing-contact`, 7 visible options at peak intent with no ranked primary.

## Emotional Journey

Trust is built in the hero — a real photograph of coaches, athletes and families, a founding year, a specific location, credible in three seconds. Trust is first lost in the stat band, the element whose entire job is credibility, on an arithmetic error any parent can do in their head. Deepest valley: Valores — four cards, one repeated icon, four sentences of virtue language, zero actionable information. False peak: the Motto is styled as the climax (full-bleed red, Playfair, paddle glyph, stars) and its content is the H1 read four sections earlier, verbatim. Wasted real peak: the Gallery, whose proof lives in `alt` text. Peak-end violation: the page ends on `© 2026 Cata Club · Todos los derechos reservados` — administration as the final impression, with no closing ask anywhere below the hero.

## Persona Red Flags

**Jordan (first-timer)** — breaks at `LandingPage.tsx:105`. Reads "FORMANDO CAMPEONES PARA LA VIDA", decides to enroll her son, clicks the biggest brightest yellowest thing — "ENTRAR" — and lands on `/login` with a password she never created. Compounding: nothing tells her the price, the coaches' names, or that a 5-to-10 age group exists, because `#horarios` isn't in the nav.

**Riley (stress tester)** — (1) resize to 900px and five schedule cards with 30px time strings crush into ~150px columns (css:126); (2) block `unpkg.com` and the map marker silently disappears, block OSM tiles and the map is a permanent grey rectangle, because `LandingMap.tsx:7` implements loading and not error; (3) tab to the footer and `aria-current="page"` still insists you are on "Inicio".

**Casey (mobile, one thumb)** — at ≤768px the navbar wraps into a three-row block that scrolls off in the first flick and never returns. From there she has no tappable action for ~5500px except a link to OpenStreetMap. At contact she must read `0994219619 · 0990288152` out of a non-interactive span, remember which is which (neither is labeled), leave the site and retype ten digits — while the red `ChatWidget` FAB (`layout.tsx:44`, `fixed bottom-5 right-5 z-40`) overlaps that corner.

## Minor Observations

- `h1` carries `aria-label` overriding identical visible text (LandingPage.tsx:102) — needless sighted/AT divergence.
- Four images carry `priority`: the 294KB hero plus all three below-the-fold gallery JPEGs (~374KB), competing with LCP on exactly the mobile connections this audience uses.
- Footer "Servicios": four labels, one destination (`:268`).
- `.landing-motto blockquote` introduces Playfair Display — a fourth typeface for one sentence, in the section that repeats the H1.
- `.landing-hero-animation` is named "animation" and contains a static `<Image>`.
- `© 2026` hardcoded (`:271`).
- `MapContainer` has `aria-label` on a `<div>` with no `role` (MapCanvas.tsx:16).
- No skip-to-content, no back-to-top on a ten-section page.
- `tailwind.config.ts` defines a full `cata.*` palette this landing uses zero of — two parallel color systems for one brand.
- `.landing-nav-links` declares `min-height: 44px` (css:56) but computes to 40px at 390px — the declaration is being overridden.

## Questions to Consider

1. If your visitor is by definition someone without an account, why is the largest brightest object on the page a door that only opens for people who already have one?
2. Your `alt` text is braver than your copy — it names a South American U11-U13 Championship the visible page never mentions. What else has this club actually done that the landing is too modest to say out loud?
3. Cover the red, swap Graduate for Inter, delete the paddle. If the remaining skeleton would work unchanged for a dental clinic in Cuenca, is this page designed for Cata Club or merely painted in its colors?
