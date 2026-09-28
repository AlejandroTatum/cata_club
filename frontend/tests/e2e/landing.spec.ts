/**
 * Landing page E2E smoke test.
 *
 * Verifies the landing page renders correctly and the main CTA navigates
 * to the login page. This is deterministic and uses semantic queries only.
 *
 * The hero was rewritten: the page's single `<h1>` used to be the club's name
 * and is now its promise ("FORMANDO CAMPEONES PARA LA VIDA"). The name lives in
 * the navbar lockup — the hero briefly carried a second copy of it and no
 * longer does. Both halves of what the old assertion protected are still
 * checked: the hero renders its headline, AND the page still identifies the
 * club, just from two different components now.
 */

import { test, expect, type Locator, type Page } from "@playwright/test";

test.describe("Landing page", () => {
  test("renders the navbar logo on a visibly light token-backed card", async ({ page }) => {
    await page.goto("/");
    // The logo is served unoptimized now (issue #681 — see `crest-no-optimizer.spec.ts`
    // for why) while the card behind it still renders with real computed
    // token styles: generous padding around the transparent crest and the
    // light-gray surface. A transparent computed background (or 5px of
    // padding) fails this.
    const img = page.locator("a.landing-logo img");
    await expect(img).toHaveCSS("padding", "8px");
    await expect(img).toHaveCSS("background-color", "rgb(249, 250, 251)");
    await expect(img).toHaveAttribute("src", "/brand/cata-club-crest-256.png");
  });

  test("stacks schedule list and panel without overflow on narrow phone widths", async ({ page }) => {
    // The schedule list only exists once GET /api/schedules reaches the ready
    // state (LandingPage's Schedule section -> ScheduleSelector), so pin the
    // payload like the sponsor test above and auto-wait for the element.
    // Measuring right after page.goto raced that fetch and flaked against a
    // slow backend.
    await page.route("**/api/schedules", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            category: "Infantil",
            blocks: [{ days: ["LUNES", "MIERCOLES", "VIERNES"], startTime: "16:00", endTime: "17:30" }],
          },
          {
            category: "Adultos",
            blocks: [{ days: ["LUNES", "MIERCOLES", "VIERNES"], startTime: "19:00", endTime: "20:30" }],
          },
        ]),
      })
    );
    for (const width of [390, 500]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      // Auto-wait for the ready state before measuring the stacked layout.
      await expect(page.locator(".landing-schedule-layout")).toBeVisible();
      const layout = await page.evaluate(() => {
        const sched = document.querySelector(".landing-schedule-layout");
        if (!sched) return null;
        const cs = getComputedStyle(sched);
        return {
          trackCount: cs.gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length,
          overflowPx: sched.scrollWidth - sched.clientWidth,
        };
      });
      expect(layout, `layout at ${width}px`).not.toBeNull();
      expect(layout?.trackCount, `stacked at ${width}px`).toBe(1);
      expect(layout?.overflowPx ?? 0, `no overflow at ${width}px`).toBeLessThanOrEqual(0);
    }
  });

  test("sponsor logos fill their card with contained sizing and stable per-record keys", async ({ page }) => {
    await page.route("**/api/sponsors", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: 1, nombre: "Municipio", logoUrl: "https://res.cloudinary.com/cata-club/image/upload/v1/logos/a.png" },
          { id: 2, nombre: "Municipio", logoUrl: "https://res.cloudinary.com/cata-club/image/upload/v1/logos/b.png" },
        ]),
      })
    );
    await page.goto("/");
    // Two copies, each repeating the two records five times: with two sponsors
    // that is what it takes for one copy to outrun a 4K viewport on real logos
    // instead of on stretched gaps (issue #765, Sponsors.tsx#repetitionsFor).
    await expect(page.locator(".landing-sponsors-item")).toHaveCount(20);
    // The gap jsdom cannot measure: every space between logos is the same, and
    // it is the token's, not whatever `min-width: 100vw` had left over.
    const spacing = await page.locator(".landing-sponsors-copy").first().evaluate((copy) => {
      const boxes = [...copy.querySelectorAll(".landing-sponsors-item")].map((item) => item.getBoundingClientRect());
      return {
        gaps: boxes.slice(1).map((box, index) => Math.round(box.left - boxes[index].right)),
        declaredGap: Math.round(parseFloat(getComputedStyle(copy).columnGap)),
        copyWidth: copy.getBoundingClientRect().width,
        viewportWidth: document.documentElement.clientWidth,
      };
    });
    expect(new Set(spacing.gaps).size).toBe(1);
    expect(spacing.gaps[0]).toBe(spacing.declaredGap);
    // And the copy still spans the viewport, so the loop has nothing to recycle
    // into — the guarantee `min-width: 100vw` exists for.
    expect(spacing.copyWidth).toBeGreaterThanOrEqual(spacing.viewportWidth);
        // Canonical public term and full brand colour: the strip no longer greys
        // or dims logos, and there is no dead href-hover restore.
        await expect(page.locator(".landing-sponsors-head")).toHaveText("Patrocinadores");
        await expect(page.locator(".landing-sponsor img").first()).toHaveCSS("filter", "none");
        await expect(page.locator(".landing-sponsor img").first()).toHaveCSS("opacity", "1");
    const metrics = await page.locator(".landing-sponsors-item >> nth=0").evaluate((item) => {
      const img = item.querySelector("img")!;
      const imgBox = img.getBoundingClientRect();
      const cardBox = item.getBoundingClientRect();
      const tile = img.closest(".landing-sponsor")!.getBoundingClientRect();
      const track = document.querySelector(".landing-sponsors-track")!;
      return {
        ratio: (imgBox.width * imgBox.height) / (cardBox.width * cardBox.height),
        imgW: imgBox.width,
        imgH: imgBox.height,
        tileH: tile.height,
        trackH: track.getBoundingClientRect().height,
      };
    });
    // Rendered ~312x120 now (issue #611): the card doubles from an 84px to a
    // 168px tile, the logo keeps filling it via contain, and the marquee must
    // not grow vertically beyond the tile.
    expect(metrics.ratio).toBeGreaterThanOrEqual(0.7);
    expect(metrics.ratio).toBeLessThanOrEqual(1.05);
    expect(metrics.imgW).toBeGreaterThanOrEqual(300);
    expect(metrics.imgH).toBeGreaterThanOrEqual(120);
    expect(metrics.tileH).toBe(168);
    expect(metrics.trackH).toBeLessThanOrEqual(metrics.tileH + 6);
  });

  test("enlarges the navbar crest and its light card, responsive on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const desktop = await page.locator("a.landing-logo img").evaluate((img) => {
      const box = img.getBoundingClientRect();
      const nav = document.querySelector(".landing-navbar")!.getBoundingClientRect();
      return { height: box.height, navHeight: nav.height };
    });
    // Issue #636: the #605 crest bump (64px card / 90px navbar) still read as
    // too small in review. This is the follow-up floor.
    expect(desktop.height).toBeGreaterThanOrEqual(76);
    expect(desktop.navHeight).toBeLessThanOrEqual(104);

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/");
    const mobile = await page.locator("a.landing-logo img").evaluate((img) => img.getBoundingClientRect().height);
    expect(mobile).toBeGreaterThanOrEqual(55);
    await expect(page.getByRole("link", { name: /cata club, inicio/i })).toBeVisible();
  });

  test("keeps the club crest undistorted inside the motto paddle on desktop and mobile", async ({ page }) => {
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 390, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/");

      const paddle = page.locator(".landing-motto [data-motto-paddle]");
      await expect(paddle).toBeVisible();
      // Decorative: excluded from the accessibility tree entirely.
      await expect(paddle).toHaveAttribute("aria-hidden", "true");

      const crest = paddle.locator("img");
      await expect(crest).toBeVisible();

      // The motto section sits far below the fold (its exact distance shifts
      // with unmocked /api/schedules and /api/sponsors payload sizes and with
      // the navbar's own height), and this crest has no `priority` prop, so
      // the browser genuinely defers its fetch under native `loading="lazy"`
      // until it nears the viewport — it never requests the asset at all
      // otherwise. `toBeVisible` only asserts CSS visibility, not that a byte
      // of image data has arrived, so naturalWidth/Height stayed 0 (an
      // undefined-vs-undefined NaN in the ratio check) whenever the section
      // happened to load far enough away not to intersect yet. Scroll it into
      // view first, exactly like a real visitor would, then wait for the
      // resulting fetch to actually finish decoding.
      await crest.scrollIntoViewIfNeeded();
      await crest.evaluate((img: HTMLImageElement) =>
        img.complete && img.naturalWidth > 0
          ? undefined
          : new Promise<void>((resolve, reject) => {
              img.addEventListener("load", () => resolve(), { once: true });
              img.addEventListener("error", () => reject(new Error("crest image failed to load")), { once: true });
            })
      );

      const metrics = await crest.evaluate((img: HTMLImageElement) => {
        const box = img.getBoundingClientRect();
        const paddleBox = img.closest("[data-motto-paddle]")!.getBoundingClientRect();
        return {
          width: box.width,
          height: box.height,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          paddleWidth: paddleBox.width,
          paddleHeight: paddleBox.height,
        };
      });

      // The crest asset is square (620x620); rendered box must stay square
      // too — any skew here would mean it got stretched instead of contained.
      const naturalRatio = metrics.naturalWidth / metrics.naturalHeight;
      const renderedRatio = metrics.width / metrics.height;
      expect(Math.abs(renderedRatio - naturalRatio)).toBeLessThan(0.05);

      // It sits inside the paddle blade, not overflowing it.
      expect(metrics.width).toBeLessThanOrEqual(metrics.paddleWidth + 1);
      expect(metrics.height).toBeLessThanOrEqual(metrics.paddleHeight + 1);
      // ...and stays legible rather than shrinking to a speck.
      expect(metrics.width).toBeGreaterThanOrEqual(metrics.paddleWidth * 0.6);
    }
  });

  test("gives the TENIS DE MESA / Cata Club wordmark more visual presence", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const desktopText = await page.locator("a.landing-logo").evaluate((el) => {
      const small = el.querySelector("small")!;
      return {
        nameSize: parseFloat(getComputedStyle(el).fontSize),
        kickerSize: parseFloat(getComputedStyle(small).fontSize),
      };
    });
    // #605 shipped 17px / 10px; #636 asks for a further, visible bump.
    expect(desktopText.nameSize).toBeGreaterThanOrEqual(20);
    expect(desktopText.kickerSize).toBeGreaterThanOrEqual(12);

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/");
    const mobileNameSize = await page
      .locator("a.landing-logo")
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    // #605 shipped 14px on mobile; must also grow here.
    expect(mobileNameSize).toBeGreaterThanOrEqual(16);
  });

  /**
   * Five breakpoints, ONE page load (issue #668).
   *
   * This test used to re-`goto("/")` inside the loop, so a single 30s budget
   * had to cover five complete page loads. That fits on a warm laptop with one
   * worker and does not fit on a 4-vCPU runner with four; CI failed here on
   * both the first attempt and the retry, on more than one commit, while every
   * other test passed. The budget was never the navbar's problem — it was the
   * five loads.
   *
   * Dropping four of them is only legitimate if the layout genuinely
   * re-evaluates on a viewport change alone, so that was measured rather than
   * assumed. The navbar is static markup styled entirely by CSS — media
   * queries at 1024px and 768px plus `vw` padding and a `clamp()` crest — with
   * no JS that reads the width. Sampling every breakpoint both ways produced
   * byte-identical results, down to sub-pixel box geometry, and five samples
   * that differ from one another: `flex-wrap` nowrap→wrap, `order` 0→3,
   * padding 71.04→32→16px, nav height 100→145→179.5px, link font 15→12px.
   * Reload and resize see the same layout; resize alone still sees five
   * different ones.
   *
   * Widest → narrowest for the same reason it always was: it reads as the
   * layout progressively giving way. Order is not load-bearing — the reverse
   * sweep measured identically — and the viewport is set before the load so
   * the first measurement is of a freshly loaded page, not a resized one.
   */
  test("keeps the navbar collision- and overflow-free at every relevant breakpoint", async ({ page }) => {
    const widths = [1280, 1024, 900, 768, 390];
    await page.setViewportSize({ width: widths[0], height: 900 });
    await page.goto("/");
    // Web fonts change every text metric under test, and `load` does not wait
    // for them. With one load there is one chance to get this right.
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      // A resize is applied at the next frame; measure after it has painted.
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      );
      const nav = page.locator(".landing-navbar");
      await expect(nav).toBeVisible();
      const overflow = await nav.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);

      // The lockup, the link list, and the CTA must not overlap one another.
      const boxes = await page.evaluate(() => {
        const rectOf = (selector: string) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
        return {
          logo: rectOf("a.landing-logo"),
          links: rectOf(".landing-nav-links"),
          cta: rectOf(".landing-nav-cta"),
        };
      });
      expect(boxes.logo, `logo box at ${width}px`).not.toBeNull();
      expect(boxes.cta, `cta box at ${width}px`).not.toBeNull();

      // Flex-wrap legitimately stacks .landing-nav-links onto its own row at
      // narrow widths, so overlap is a real 2D rectangle intersection, not a
      // same-row left/right comparison.
      const intersects = (a: DOMRect, b: DOMRect, tolerance = 1) =>
        a.left < b.right - tolerance &&
        a.right > b.left + tolerance &&
        a.top < b.bottom - tolerance &&
        a.bottom > b.top + tolerance;

      if (boxes.logo && boxes.links && boxes.links.width > 0) {
        expect(intersects(boxes.logo, boxes.links), `logo/links overlap at ${width}px`).toBe(false);
      }
      if (boxes.logo && boxes.cta) {
        expect(intersects(boxes.logo, boxes.cta), `logo/cta overlap at ${width}px`).toBe(false);
      }
      if (boxes.links && boxes.cta && boxes.links.width > 0) {
        expect(intersects(boxes.links, boxes.cta), `links/cta overlap at ${width}px`).toBe(false);
      }
    }
  });

  test("keeps the crest's aspect ratio while it scales up", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const ratio = await page.locator("a.landing-logo img").evaluate((img) => {
      const box = img.getBoundingClientRect();
      return box.width / box.height;
    });
    // Square crest (620x620 source): must stay square, not stretched.
    expect(ratio).toBeGreaterThanOrEqual(0.9);
    expect(ratio).toBeLessThanOrEqual(1.1);
  });

  test("shows a visible, operable keyboard focus ring on the brand lockup link", async ({ page }) => {
    await page.goto("/");
    const logo = page.locator("a.landing-logo");
    await logo.focus();
    await expect(logo).toBeFocused();
    const outline = await logo.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
    });
    expect(outline.style).not.toBe("none");
    expect(outline.width).toBeGreaterThan(0);
  });

  test("renders hero and navigates to login via CTA", async ({ page }) => {
    await page.goto("/");

    // The hero headline is the page's only h1 (LandingPage.tsx `Hero`).
    await expect(
      page.getByRole("heading", {
        name: /formando\s+campeones\s+para\s+la\s+vida/i,
        level: 1,
      })
    ).toBeVisible();

    // The club still names itself — now through the navbar brand mark.
    await expect(page.getByRole("link", { name: /cata club, inicio/i })).toBeVisible();

    // The navbar's quiet "ENTRAR" is the landing's one door to the login form;
    // the hero's loud CTAs go to enrolment instead. Asserting the href as well
    // as the click keeps this a real navigation to a fixed route.
    const cta = page.getByRole("link", { name: /^entrar$/i });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", "/login");

    // Navigate to login via CTA
    await cta.click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });

    // Assert login form has rendered
    await expect(
      page.getByRole("heading", { name: /bienvenido/i })
    ).toBeVisible({ timeout: 10_000 });
  });

  /**
   * The Valores rally (issue #594) used to pin the whole section under a ball
   * scrubbing an SVG guide. Issue #637 found it left values off screen on a
   * phone; the fix chosen here is not a better scrub — it is no scrub at all.
   * The approved prototype (`landing-valores-b-tablero.html`) replaces it with
   * a static tablero: four numeral tiles and four value articles sharing one
   * CSS grid, so every title lines up by construction and nothing can be
   * "reached" off screen because nothing moves as the page scrolls.
   */
  test.describe("values tablero", () => {
    /** Every `.landing-tablero-item h3`'s top, rounded, in DOM order. */
    const readTitleTops = (page: import("@playwright/test").Page): Promise<number[]> =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>(".landing-tablero-item h3")).map(
          (h3) => Math.round(h3.getBoundingClientRect().top),
        ),
      );

    test("renders four tiles and four items with every title sharing the same top, on desktop", async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await page.locator(".landing-tablero").scrollIntoViewIfNeeded();

      await expect(page.locator(".landing-tablero-tile")).toHaveCount(4);
      await expect(page.locator(".landing-tablero-item")).toHaveCount(4);

      // `LandingMotion.tsx` staggers each `.landing-tablero-item` in with
      // `gsap.from([data-reveal], { y: 40, opacity: 0, stagger: 0.1, ... })`;
      // the LAST item finishes last, so its opacity settling at 1 is the
      // explicit signal the whole group has stopped moving — the poll below
      // is not the only guard against measuring mid-animation.
      await expect(page.locator(".landing-tablero-item").last()).toHaveCSS("opacity", "1");

      // Grid alignment is a layout fact once settled, not a race — but a
      // slower CI runner can still catch the tail of the stagger, so poll
      // instead of reading once. The unique, sorted tops are the message
      // Playwright prints on timeout, e.g. "[501,517,532]".
      await expect
        .poll(
          async () => JSON.stringify([...new Set(await readTitleTops(page))].sort((a, b) => a - b)),
          { timeout: 10_000, message: "every title shares one top edge once the reveal settles" },
        )
        .toMatch(/^\[\d+\]$/);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "no horizontal page scroll").toBeLessThanOrEqual(0);
    });

    test("pairs its two-column titles by top edge on a phone", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      await page.locator(".landing-tablero").scrollIntoViewIfNeeded();

      await expect(page.locator(".landing-tablero-item").last()).toHaveCSS("opacity", "1");

      await expect
        .poll(async () => JSON.stringify(await readTitleTops(page)), {
          timeout: 10_000,
          message: "each pair shares a top edge once the reveal settles",
        })
        .toMatch(/^\[(\d+),\1,(\d+),\2\]$/);

      const settledTops = await readTitleTops(page);
      expect(settledTops[0], "the two pairs sit at different heights").not.toBe(settledTops[2]);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "no horizontal page scroll").toBeLessThanOrEqual(0);
    });

    test("keeps every value visible and legible under reduced motion, no rally hooks in the DOM", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");

      expect(await page.locator("[data-rally]").count(), "no rally element ever renders").toBe(0);

      const items = page.locator(".landing-tablero-item");
      await expect(items).toHaveCount(4);
      for (const title of ["Respeto", "Disciplina", "Esfuerzo", "Compañerismo"]) {
        const item = items.filter({ hasText: title });
        await item.scrollIntoViewIfNeeded();
        await expect(item).toBeVisible();
        await expect(item).toHaveCSS("opacity", "1");
      }

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "no horizontal page scroll under reduced motion").toBeLessThanOrEqual(0);
    });

    test("retires Logros with no dead anchor left behind (issue #1372)", async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");

      // The section and the tablero's exit cue into it are gone; a dead
      // anchor is worse than no section, so nothing anywhere on the page —
      // navbar, tablero or footer — may still target `#logros`.
      await expect(page.locator("#logros")).toHaveCount(0);
      await expect(page.locator(".landing-tablero-cue")).toHaveCount(0);
      const deadLinks = await page.evaluate((): string[] =>
        Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href='#logros']")).map((link): string => link.textContent ?? ""),
      );
      expect(deadLinks).toEqual([]);

      // Values now flows straight into the CTA band that followed Logros.
      const flow = await page.evaluate(() => {
        const values = document.querySelector<HTMLElement>(".landing-values");
        const motto = document.querySelector<HTMLElement>(".landing-motto");
        if (!values || !motto) return null;
        return { mottoIsNextSection: values.nextElementSibling === motto };
      });
      expect(flow, "Values and the CTA band render").not.toBeNull();
      expect(flow?.mottoIsNextSection, "The CTA band follows Values directly").toBe(true);
    });
  });

  /**
   * The gallery is the pre-#1372 full-bleed moving strip again, fed by
   * GET /api/galeria (issue #1372). The e2e harness starts no backend, so
   * the catalog is answered through route stubs — the same pattern
   * `legal-header-session.spec.ts` uses for the session answer. What the
   * browser proves here is what jsdom cannot: the motion runtime really
   * enhances an asynchronously readied track, the loop geometry keeps the
   * pre-#1372 slide height, and the caption reveal/hold behaviors work with
   * real pointer and keyboard events. Reduced motion gets its own test:
   * the same markup must present complete and motionless.
   */
  test.describe("gallery", () => {
    /**
     * The fixture photo rides on the one image host the app's CSP allows
     * (`res.cloudinary.com`) and is answered by a route stub with a tiny
     * real PNG — so the browser exercises the real measured-ratio path, not
     * the fallback. (A `data:` URL would be CSP-blocked and silently prove
     * only the onerror fallback.)
     */
    const PHOTO = "https://res.cloudinary.com/club/en-juego.png";
    const PHOTO_PNG = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );

    const publishOnePhoto = async (page: Page): Promise<void> => {
      await page.route("**/api/galeria", (route): Promise<void> =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            { id: 1, titulo: "En juego", descripcion: "Una jugada frente al público de la sala.", imagenUrl: PHOTO },
          ]),
        }));
      await page.route("**/res.cloudinary.com/**", (route): Promise<void> =>
        route.fulfill({ status: 200, contentType: "image/png", body: PHOTO_PNG }));
    };

    /** Two published photos — the first catalog where an arrow means anything. Both share the fixture bytes, so both slides measure the same ratio and the loop math stays symmetric. */
    const publishTwoPhotos = async (page: Page): Promise<void> => {
      await page.route("**/api/galeria", (route): Promise<void> =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            { id: 1, titulo: "En juego", descripcion: "Una jugada frente al público de la sala.", imagenUrl: PHOTO },
            { id: 2, titulo: "La final", descripcion: "El punto decisivo del torneo regional.", imagenUrl: PHOTO },
          ]),
        }));
      await page.route("**/res.cloudinary.com/**", (route): Promise<void> =>
        route.fulfill({ status: 200, contentType: "image/png", body: PHOTO_PNG }));
    };

    test("says the gallery is empty until the club publishes photos", async ({ page }) => {
      // The empty catalog is the production truth for a fresh club, so the
      // payload is answered here: the e2e harness (lane and CI alike) starts
      // no backend and sets no BACKEND_API_URL, and an unanswerable BFF makes
      // the page report the fetch error instead of the empty state under
      // test — the same route-stub pattern `legal-header-session.spec.ts`
      // uses for the session answer. What the page RENDERS for an empty
      // catalog is this test's contract; the BFF's own plumbing is jsdom
      // territory (LandingPage.test.tsx).
      await page.route("**/api/galeria", (route): Promise<void> =>
        route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));

      await page.goto("/");
      const gallery = page.locator("#galeria");
      await expect(gallery.getByRole("heading", { name: "Galería" })).toBeVisible();
      await expect(gallery.getByRole("status")).toHaveText(/Aún no hay fotos en la galería\./);
      await expect(gallery.locator("img")).toHaveCount(0);
    });

    test("runs the restored loop over a one-photo catalog with silent clones", async ({ page }) => {
      await publishOnePhoto(page);
      await page.goto("/");

      const gallery = page.locator("#galeria");
      await gallery.scrollIntoViewIfNeeded();

      const track = page.locator("[data-carousel]");
      await expect(track).toHaveAttribute("data-ready", "true");
      // Async data started the loop: the runtime enhanced the ready track.
      await expect(track).toHaveClass(/is-enhanced/, { timeout: 15_000 });

      // The pre-#1372 desktop slide height, back for good.
      const firstSlide = track.locator(".landing-slide").first();
      await expect(firstSlide).toHaveCSS("height", "468px");

      // One photo cannot cover the viewport, so the run repeats — but every
      // repeat is aria-hidden and unfocusable, and exactly one photo speaks.
      const slides = track.locator(".landing-slide");
      expect(await slides.count()).toBeGreaterThan(1);
      const clones = track.locator("li.landing-slide-clone");
      expect(await clones.count()).toBe((await slides.count()) - 1);
      const cloneCount = await clones.count();
      for (let index = 0; index < cloneCount; index += 1) {
        await expect(clones.nth(index)).toHaveAttribute("aria-hidden", "true");
      }
      await expect(track.locator("li:not(.landing-slide-clone) img")).toHaveCount(1);

      // Reading holds the loop still and reveals the caption. Hover the
      // stationary track first: a moving slide never passes Playwright's
      // stability check, and holding is exactly what stops it.
      type HoldsWindow = Window & { __galleryHolds?: boolean[] };
      await page.evaluate((): void => {
        (window as HoldsWindow).__galleryHolds = [];
        document.addEventListener("landing:gallery-hold", (event): void => {
          const detail = (event as CustomEvent<{ held: boolean }>).detail;
          (window as HoldsWindow).__galleryHolds!.push(detail.held);
        });
      });
      await track.hover();
      await firstSlide.hover();
      await expect(firstSlide.locator(".landing-slide-caption")).toHaveCSS("opacity", "1");
      let holds = await page.evaluate((): boolean[] => (window as HoldsWindow).__galleryHolds ?? []);
      expect(holds).toContain(true);

      // Leaving the strip releases the hold and hides the caption again.
      await page.mouse.move(5, 5);
      await expect(firstSlide.locator(".landing-slide-caption")).toHaveCSS("opacity", "0");
      holds = await page.evaluate((): boolean[] => (window as HoldsWindow).__galleryHolds ?? []);
      expect(holds.at(-1)).toBe(false);

      // Keyboard reaches the same caption, on the same terms.
      await firstSlide.focus();
      await expect(firstSlide.locator(".landing-slide-caption")).toHaveCSS("opacity", "1");

      // Cards are still not controls: nothing opens, nothing navigates.
      expect(await gallery.getByRole("button").count()).toBe(0);
      await firstSlide.click();
      await expect(page.locator("[role='dialog']")).toHaveCount(0);
    });

    /** Installs the hold recorder the browse tests read back. */
    const trackHolds = async (page: Page): Promise<void> => {
      type HoldsWindow = Window & { __galleryHolds?: boolean[] };
      await page.evaluate((): void => {
        (window as HoldsWindow).__galleryHolds = [];
        document.addEventListener("landing:gallery-hold", (event): void => {
          const detail = (event as CustomEvent<{ held: boolean }>).detail;
          (window as HoldsWindow).__galleryHolds!.push(detail.held);
        });
      });
    };
    const holdsSeen = (page: Page): Promise<boolean[]> =>
      page.evaluate((): boolean[] => (window as { __galleryHolds?: boolean[] }).__galleryHolds ?? []);

    /** The unique slide for a catalog index — the presentation-only clones never count. The FIGURE is measured, not its li: the loop's transforms land on `.landing-slide` elements, while the li is the static flex slot they travel through. */
    const uniqueSlide = (track: Locator, index: number): Locator =>
      track.locator("li:not(.landing-slide-clone)").nth(index).locator(".landing-slide");

    /** Waits until the slide sits aligned at the strip's left edge (±3px). */
    const expectAligned = async (slide: Locator, label: string): Promise<void> => {
      await expect
        .poll(async (): Promise<number> => {
          const box = await slide.boundingBox();
          return box ? Math.abs(box.x) : Number.POSITIVE_INFINITY;
        }, { timeout: 6_000, intervals: [100] })
        .toBeLessThan(3);
      await expect(slide.locator(".landing-slide-caption"), `${label} caption is the one being read`)
        .toHaveCSS("opacity", "1");
    };

    test("brings the requested photo to the strip's edge, holds it for reading, then resumes", async ({ page }) => {
      await publishTwoPhotos(page);
      await page.goto("/");

      const gallery = page.locator("#galeria");
      await gallery.scrollIntoViewIfNeeded();
      const track = page.locator("[data-carousel]");
      await expect(track).toHaveClass(/is-enhanced/, { timeout: 15_000 });
      await trackHolds(page);

      const next = gallery.getByRole("button", { name: "Foto siguiente" });
      const second = uniqueSlide(track, 1);
      await next.click();

      // The requested photo visibly arrives — aligned at the viewport's left
      // edge, caption open — instead of the loop merely continuing past it.
      await expectAligned(second, "photo 2");

      // Give any in-flight seek room to land, then prove the strip is HELD:
      // two samples 500ms apart agree to sub-pixel while the caption is read.
      await page.waitForTimeout(1_300);
      const still1 = (await second.boundingBox())!.x;
      await page.waitForTimeout(500);
      const still2 = (await second.boundingBox())!.x;
      expect(Math.abs(still2 - still1)).toBeLessThan(1);

      // The reading window ends on its own: the hold releases and the
      // marquee resumes from where the seek parked it (~60px/s leftward).
      await expect.poll((): Promise<boolean | undefined> => holdsSeen(page).then((holds): boolean | undefined => holds.at(-1)), { timeout: 9_000, intervals: [250] })
        .toBe(false);
      const moving1 = (await second.boundingBox())!.x;
      await page.waitForTimeout(900);
      const moving2 = (await second.boundingBox())!.x;
      expect(moving2).toBeLessThan(moving1 - 20);
    });

    test("wraps previous around the seam and walks the ring in both directions", async ({ page }) => {
      await publishTwoPhotos(page);
      await page.goto("/");

      const gallery = page.locator("#galeria");
      await gallery.scrollIntoViewIfNeeded();
      const track = page.locator("[data-carousel]");
      await expect(track).toHaveClass(/is-enhanced/, { timeout: 15_000 });

      // "Previous" from the strip's starting photo travels BACKWARD through
      // the seam to the catalog's last photo — the loop is endless both ways.
      const first = uniqueSlide(track, 0);
      const second = uniqueSlide(track, 1);
      await gallery.getByRole("button", { name: "Foto anterior" }).click();
      await expectAligned(second, "photo 2");

      // And "next" from there comes forward to photo 1 again.
      await gallery.getByRole("button", { name: "Foto siguiente" }).click();
      await expectAligned(first, "photo 1");
    });

    test("presents the complete strip without motion under reduced motion", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await publishOnePhoto(page);
      await page.goto("/");

      const gallery = page.locator("#galeria");
      await gallery.scrollIntoViewIfNeeded();

      const track = page.locator("[data-carousel]");
      await expect(track).toHaveAttribute("data-ready", "true");
      // The runtime never mounts for this visitor; give any would-be
      // enhancement a beat to prove it never arrives.
      await page.waitForTimeout(1_500);
      await expect(track).not.toHaveClass(/is-enhanced/);

      // The loop-only visual clones drop out instead of publishing duplicates.
      const clones = track.locator("li.landing-slide-clone");
      const cloneCount = await clones.count();
      expect(cloneCount).toBeGreaterThan(0);
      for (let index = 0; index < cloneCount; index += 1) {
        await expect(clones.nth(index)).toBeHidden();
      }

      // Info stays available without motion: a tap reveals the caption.
      const slide = track.locator(".landing-slide").first();
      await slide.click();
      await expect(slide.locator(".landing-slide-caption")).toHaveCSS("opacity", "1");
      await expect(gallery.getByRole("heading", { name: "Galería" })).toBeVisible();
    });

    test("offers no browse controls under reduced motion — the wrapped strip needs none", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await publishTwoPhotos(page);
      await page.goto("/");

      const gallery = page.locator("#galeria");
      await gallery.scrollIntoViewIfNeeded();
      const track = page.locator("[data-carousel]");
      await expect(track).toHaveAttribute("data-ready", "true");

      // The controls drive the loop; with no loop they drop out entirely
      // (CSS `display: none` takes them out of the accessibility tree too).
      await expect(gallery.locator(".landing-gallery-nav")).toBeHidden();

      // The whole catalog is already on the page, in order, motionless.
      await expect(track.locator("li:not(.landing-slide-clone)")).toHaveCount(2);
      await expect(track.locator("li:not(.landing-slide-clone)").first()).toBeVisible();
    });
  });

  /**
   * Hero spacing under the editorial redesign.
   *
   * This block used to measure a two-column grid (photo framed in its own
   * column, `aspect-ratio: 6/5`, height set by the frame) after the hero's
   * duplicate brand mark was removed from it — "does the copy's rowGap widen
   * enough to close the resulting slack". That grid is gone: the photo is
   * now a full-bleed background behind the copy (`.landing-hero-carousel`,
   * `position: absolute`), and the copy is bottom-anchored over it with
   * `align-items: end`. "Slack above/below the copy" and "gap between copy
   * and frame" no longer describe anything the CSS does, so a spec that kept
   * asserting them next to the old accepted ranges was pinning numbers with
   * no design behind them, and started failing (`copyRowGap` 30 vs a floor
   * of 36; `headlineInset` 277/400 vs a ceiling of 100) the moment the
   * editorial hero replaced the grid.
   *
   * What still matters, and is asserted here instead:
   *
   *   - The duplicate brand mark stays gone (unchanged from before).
   *   - Desktop: the copy sits flush against the hero's own bottom padding —
   *     the entire point of `align-items: end` — rather than floating with a
   *     gap that would only appear if that alignment regressed.
   *   - Mobile: the headline starts right where the top padding ends, and
   *     that padding (400px) is tuned to clear the mobile photo band's fixed
   *     height (360px, see `.landing-hero-carousel`'s mobile rule) with a
   *     small margin — a regression here means the band and the padding
   *     drifted apart, which either overlaps the copy or opens a gap.
   *
   * Both numbers are measured in a real browser after layout and fonts
   * settle. jsdom computes none of this — it has no box model for
   * `clamp()`, `position: absolute` or `align-items` — which is why these
   * assertions live here and not in `LandingPage.test.tsx`.
   */
  test.describe("hero spacing under the editorial redesign", () => {
    /** Hero box metrics that only exist once a real engine has laid it out. */
    const measureHero = async (page: import("@playwright/test").Page) => {
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);
      await page.locator(".landing-hero h1").waitFor();
      return page.evaluate(() => {
        const hero = document.querySelector(".landing-hero") as HTMLElement;
        const copy = document.querySelector(".landing-hero-copy") as HTMLElement;
        const headline = hero.querySelector("h1") as HTMLElement;
        const heroStyle = getComputedStyle(hero);
        const heroBox = hero.getBoundingClientRect();
        const copyBox = copy.getBoundingClientRect();
        return {
          heroText: hero.textContent ?? "",
          brandCount: hero.querySelectorAll(".landing-hero-brand").length,
          // How far the copy's own bottom edge sits from the hero's bottom
          // padding line — 0 when `align-items: end` is doing its job.
          copyBottomGap: (heroBox.bottom - parseFloat(heroStyle.paddingBottom)) - copyBox.bottom,
          headlineInset: headline.getBoundingClientRect().top - heroBox.top,
        };
      });
    };

    test("keeps the copy flush against the hero's own bottom padding on desktop", async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const hero = await measureHero(page);

      expect(hero.brandCount).toBe(0);
      expect(hero.heroText).not.toMatch(/tenis de mesa/i);
      expect(Math.abs(hero.copyBottomGap)).toBeLessThanOrEqual(1);
    });

    test("keeps the mobile headline clear of the photo band without opening a second gap", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const hero = await measureHero(page);

      expect(hero.brandCount).toBe(0);
      expect(hero.heroText).not.toMatch(/tenis de mesa/i);

      // The band is 360px tall; the headline should start within a small
      // margin past its bottom edge, never inside it and never far below it.
      expect(hero.headlineInset).toBeGreaterThanOrEqual(360);
      expect(hero.headlineInset).toBeLessThanOrEqual(420);
      expect(Math.abs(hero.copyBottomGap)).toBeLessThanOrEqual(1);
    });
  });

  /**
   * The unit suite proves the link is built from one constant. This proves the
   * page a visitor actually receives still carries that link intact — marker
   * and viewport on the same point — and that the landmark and the Plus Code
   * both survive into real rendered output, not just into jsdom.
   */
  test("hands out one directions link whose marker and viewport agree", async ({ page }) => {
    await page.goto("/");

    const directions = page.locator(".landing-contact a", { hasText: /cómo llegar/i });
    const href = await directions.getAttribute("href");
    expect(href).toBeTruthy();

    const url = new URL(href as string);
    expect(`${url.origin}${url.pathname}`).toBe("https://www.openstreetmap.org/");

    const latitude = url.searchParams.get("mlat");
    const longitude = url.searchParams.get("mlon");
    expect(latitude).toBeTruthy();
    expect(longitude).toBeTruthy();

    const [, hashLatitude, hashLongitude] = url.hash.replace("#map=", "").split("/");
    expect(Number(hashLatitude)).toBe(Number(latitude));
    expect(Number(hashLongitude)).toBe(Number(longitude));

    const location = page.locator(".landing-location");
    await expect(location).toContainText(/junto al Coliseo Ciudad de Loja/i);
    await expect(location).toContainText("XQVW+J63, 110102 Loja");
  });
});
