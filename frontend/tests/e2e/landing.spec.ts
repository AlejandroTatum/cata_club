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

import { test, expect } from "@playwright/test";

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
      await expect(page.locator(".landing-sched")).toBeVisible();
      const layout = await page.evaluate(() => {
        const sched = document.querySelector(".landing-sched");
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
   * The Valores rally (issue #594) pins the whole section under a ball that
   * scrubs along an SVG guide, lighting each value as it passes. Issue #637
   * reported that on a phone the rally "only reaches value 01" and that value
   * 04 falls outside the viewport.
   *
   * The cause is geometric, so only a real browser can see it: at 390x844 the
   * Valores section is ~1249px tall. Pinning freezes it with its top at the
   * viewport top, so values 03 and 04 sit below the fold for the ENTIRE 1900px
   * scrub. The counter still climbs to 4/4 and the `hit` class still lands on
   * every card — off screen, where nobody can see it. Asserting the counter,
   * or the class, or a screenshot of the top of the section would all have
   * passed on the broken build.
   *
   * So the assertion is the one the reader actually cares about: each value is
   * activated at a moment when that value is on screen.
   */
  test.describe("values rally", () => {
    /** Runs in the page: one frame of rally state, measured, never inferred. */
    const sampleRally = (): {
      atEnd: boolean;
      counter: string;
      pageOverflowPx: number;
      pinned: boolean;
      sectionTop: number;
      sectionBottom: number;
      cards: { hit: boolean; dim: boolean; onScreen: boolean; opacity: string }[];
    } => {
      const root = document.documentElement;
      const section = document.querySelector(".landing-values");
      const rect = section?.getBoundingClientRect();
      const viewport = window.innerHeight;
      return {
        atEnd: window.scrollY + viewport >= root.scrollHeight - 2,
        counter: document.querySelector("[data-rally-counter]")?.textContent?.trim() ?? "",
        pageOverflowPx: root.scrollWidth - root.clientWidth,
        // ScrollTrigger pins by fixing the element in place; nothing else on
        // this page makes the section `fixed`.
        pinned: section ? getComputedStyle(section).position === "fixed" : false,
        sectionTop: rect ? Math.round(rect.top) : Number.NaN,
        sectionBottom: rect ? Math.round(rect.bottom) : Number.NaN,
        cards: Array.from(document.querySelectorAll<HTMLElement>(".landing-values [data-value]")).map(
          (card) => {
            const box = card.getBoundingClientRect();
            return {
              hit: card.classList.contains("hit"),
              dim: card.classList.contains("dim"),
              // Fully inside the viewport — a card half off the fold is not a
              // card the visitor saw light up.
              onScreen: box.top >= 0 && box.bottom <= viewport,
              opacity: getComputedStyle(card).opacity,
            };
          },
        ),
      };
    };

    type RallyWalk = {
      /** Per value: did it carry `hit` while fully on screen at least once? */
      activatedOnScreen: boolean[];
      /** Per value: did it carry `hit` at any point, on screen or not? */
      activatedAnywhere: boolean[];
      highestCounter: number;
      maxPageOverflowPx: number;
      /** Was the section ever pinned — the desktop choreography's signature? */
      everPinned: boolean;
      /** Frames where the counter, `hit` and `dim` disagreed with each other. */
      desyncs: string[];
      cardCount: number;
    };

    /**
     * Scrolls the page through the Valores section with real wheel input —
     * Lenis owns the scroll, so `window.scrollTo` would be fighting it — and
     * records what the rally did on the way.
     */
    async function walkRally(page: import("@playwright/test").Page): Promise<RallyWalk> {
      const walk: RallyWalk = {
        activatedOnScreen: [],
        activatedAnywhere: [],
        highestCounter: 0,
        maxPageOverflowPx: 0,
        everPinned: false,
        desyncs: [],
        cardCount: 0,
      };

      const record = (frame: ReturnType<typeof sampleRally>): void => {
        walk.cardCount = frame.cards.length;
        if (walk.activatedOnScreen.length === 0) {
          walk.activatedOnScreen = frame.cards.map(() => false);
          walk.activatedAnywhere = frame.cards.map(() => false);
        }
        walk.maxPageOverflowPx = Math.max(walk.maxPageOverflowPx, frame.pageOverflowPx);
        if (frame.pinned) walk.everPinned = true;
        const counter = Number.parseInt(frame.counter, 10);
        if (Number.isFinite(counter)) walk.highestCounter = Math.max(walk.highestCounter, counter);
        frame.cards.forEach((card, index) => {
          if (card.hit) walk.activatedAnywhere[index] = true;
          if (card.hit && card.onScreen) walk.activatedOnScreen[index] = true;
        });
        // Ball, impact and card state all move through one `reach(index)` call,
        // so the counter and the classes may never disagree about which value
        // the ball is on.
        const lit = frame.cards.findIndex((card) => card.hit);
        if (lit >= 0) {
          if (counter !== lit + 1) walk.desyncs.push(`counter=${frame.counter} but value ${lit + 1} is lit`);
          // Everything after the lit value stays dimmed; nothing before it does.
          const wrongDim = frame.cards.findIndex((card, index) => card.dim !== (index > lit));
          if (wrongDim >= 0) walk.desyncs.push(`value ${wrongDim + 1} dim=${frame.cards[wrongDim].dim} with value ${lit + 1} lit`);
        }
      };

      // Approach: coarse steps, stopping a full coarse step short of the
      // section. Handing over any later let one 600px stride carry a 390px
      // viewport clean past the window in which value 01 is lit — the walk
      // would have reported the bug it was still sampling too coarsely to see.
      const viewport = page.viewportSize()!.height;
      for (let step = 0; step < 40; step += 1) {
        const frame = await page.evaluate(sampleRally);
        record(frame);
        if (frame.atEnd || frame.sectionTop <= viewport + 800) break;
        await page.mouse.wheel(0, 600);
        await page.waitForTimeout(70);
      }

      // Traverse: fine steps, so a value that is only lit for one card-height
      // of scroll is still sampled while it is on screen.
      for (let step = 0; step < 90; step += 1) {
        const frame = await page.evaluate(sampleRally);
        record(frame);
        if (frame.atEnd || frame.sectionBottom < 0) break;
        await page.mouse.wheel(0, 70);
        await page.waitForTimeout(100);
      }

      return walk;
    }

    const PHONES = [
      { label: "portrait", width: 390, height: 844 },
      { label: "landscape", width: 844, height: 390 },
    ];

    for (const phone of PHONES) {
      test(`activates all four values while each is on screen (${phone.label} ${phone.width}x${phone.height})`, async ({
        page,
      }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width: phone.width, height: phone.height });
        await page.goto("/");
        await expect(page.locator(".landing-values [data-value]")).toHaveCount(4);

        const walk = await walkRally(page);

        expect(walk.cardCount, "four values render").toBe(4);
        // The regression, stated plainly. On the build that shipped it, this
        // failed at value 03 in portrait and at value 01 in landscape, each
        // time with `lit anywhere=true` — the class was applied, off screen.
        ["01", "02", "03", "04"].forEach((label, index) => {
          expect(
            walk.activatedOnScreen[index],
            `value ${label} lit up while on screen (${phone.label}); lit anywhere=${walk.activatedAnywhere[index]}`,
          ).toBe(true);
        });
        expect(walk.highestCounter, "counter reaches 4/4").toBe(4);
        expect(walk.desyncs, "counter, hit and dim stay in step").toEqual([]);
        expect(walk.maxPageOverflowPx, "no horizontal page scroll").toBeLessThanOrEqual(0);
        // The mechanism, named: a section this much taller than the phone
        // viewport must not be pinned, because pinning is what put three of the
        // four values off screen.
        expect(walk.everPinned, "the section never pins on a phone").toBe(false);
      });
    }

    /**
     * The other half of the fix: nothing above changes what a desktop already
     * does. At 1440x900 the section is 711px, it fits, and the original pinned
     * choreography is exactly what has to keep running.
     */
    test("keeps the pinned desktop choreography", async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await expect(page.locator(".landing-values [data-value]")).toHaveCount(4);

      const walk = await walkRally(page);

      expect(walk.everPinned, "the section still pins on the desktop").toBe(true);
      ["01", "02", "03", "04"].forEach((label, index) => {
        expect(walk.activatedOnScreen[index], `value ${label} lit up while on screen on the desktop`).toBe(true);
      });
      expect(walk.highestCounter, "counter reaches 4/4").toBe(4);
      expect(walk.desyncs, "counter, hit and dim stay in step").toEqual([]);
      expect(walk.maxPageOverflowPx, "no horizontal page scroll").toBeLessThanOrEqual(0);
    });

    test("re-evaluates the rally after an orientation change", async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      await expect(page.locator(".landing-values [data-value]")).toHaveCount(4);
      await walkRally(page);

      // Rotate mid-visit without reloading: the rally has to rebuild against
      // the new geometry rather than keep the layout it measured on load.
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForTimeout(600);
      await page.mouse.wheel(0, -20_000);
      await page.waitForTimeout(600);

      const walk = await walkRally(page);
      ["01", "02", "03", "04"].forEach((label, index) => {
        expect(walk.activatedOnScreen[index], `value ${label} lit up while on screen after rotating`).toBe(true);
      });
      expect(walk.maxPageOverflowPx, "no horizontal page scroll after rotating").toBeLessThanOrEqual(0);
    });

    test("leaves every value legible on a phone under reduced motion", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");

      const values = page.locator(".landing-values [data-value]");
      await expect(values).toHaveCount(4);
      for (const label of ["01", "02", "03", "04"]) {
        const card = values.filter({ hasText: label });
        await card.scrollIntoViewIfNeeded();
        await expect(card).toBeVisible();
        // Reduced motion must not leave a value stranded at the 0.32 opacity
        // `dim` gives it, nor pinned off screen.
        await expect(card).not.toHaveClass(/\bdim\b/);
        await expect(card).toHaveCSS("opacity", "1");
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "no horizontal page scroll under reduced motion").toBeLessThanOrEqual(0);
    });
  });

  /**
   * The gallery carousel is driven by a GSAP timeline whose geometry only
   * exists once the browser has laid the strip out, so jsdom cannot see any of
   * this. Both regressions below shipped looking perfectly correct in a
   * screenshot, which is exactly why they are measured here.
   */
  test.describe("gallery carousel", () => {
    test("spaces slides by their own width plus the flex gap", async ({ page }) => {
      await page.goto("/");
      const track = page.locator("[data-carousel]");
      await expect(track).toHaveClass(/is-enhanced/, { timeout: 10_000 });

      // `figure` carries a UA margin of `1em 40px`. Unreset, it adds 80px of
      // layout width per slide, so the loop measures a track wider than the
      // visible one and the spacing silently drifts.
      // Slides keep their own aspect ratio, so each step is that slide's own
      // width plus the gap — never one shared width.
      const steps = await track.evaluate((element: HTMLElement) => {
        const slides = Array.from(element.querySelectorAll<HTMLElement>(".landing-slide"));
        const gap = parseFloat(getComputedStyle(element).columnGap) || 0;
        return slides.slice(1, 6).map((slide, index) => ({
          actual: slide.offsetLeft - slides[index].offsetLeft,
          expected: slides[index].offsetWidth + gap,
        }));
      });

      expect(steps.length).toBeGreaterThan(0);
      steps.forEach((step) => {
        expect(Math.abs(step.actual - step.expected)).toBeLessThanOrEqual(1);
      });
    });

    /**
     * The defect this guards shipped invisibly: a landscape photo in a portrait
     * frame made height the binding dimension under `object-fit: cover`, so the
     * browser upscaled a file it had chosen by width alone — one slide by 2.23x.
     */
    test("never paints a slide larger than the file it downloaded", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator("[data-carousel]")).toHaveClass(/is-enhanced/, { timeout: 10_000 });
      await page.locator("[data-carousel]").scrollIntoViewIfNeeded();

      // Lazy slides only decode once they have been near the viewport.
      await expect
        .poll(async () =>
          page.locator(".landing-slide img").evaluateAll(
            (images: HTMLImageElement[]) => images.filter((image) => image.naturalWidth > 0).length,
          ),
        { timeout: 15_000 })
        .toBeGreaterThan(3);

      const upscaled = await page.locator(".landing-slide img").evaluateAll((images: HTMLImageElement[]) =>
        images
          .filter((image) => image.naturalWidth > 0)
          .map((image) => {
            const box = image.getBoundingClientRect();
            return {
              src: image.currentSrc,
              scale: Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight),
            };
          })
          // 1.05 absorbs sub-pixel rounding and the srcset ladder's granularity.
          .filter((entry) => entry.scale > 1.05),
      );

      expect(upscaled).toEqual([]);
    });

    test("moves the strip continuously on its own, with no user steering", async ({ page }) => {
      await page.goto("/");
      const track = page.locator("[data-carousel]");
      await expect(track).toHaveClass(/is-enhanced/, { timeout: 10_000 });
      await track.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);

      const firstSlide = page.locator(".landing-slide").first();
      const before = (await firstSlide.boundingBox())?.x ?? 0;
      // No pointer, wheel, or keyboard input of any kind: the strip advances
      // by itself, so its position must drift without any gesture.
      await page.waitForTimeout(1500);
      const after = (await firstSlide.boundingBox())?.x ?? 0;
      expect(Math.abs(after - before)).toBeGreaterThan(30);
    });

    test("keeps normal vertical page scrolling when the wheel passes over the gallery", async ({ page }) => {
      await page.goto("/");
      const track = page.locator("[data-carousel]");
      await expect(track).toHaveClass(/is-enhanced/, { timeout: 10_000 });
      await track.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);

      const before = await page.evaluate(() => scrollY);
      await track.dispatchEvent("wheel", { deltaY: 700, bubbles: true, cancelable: true });
      await page.waitForTimeout(700);
      const after = await page.evaluate(() => scrollY);

      // The gallery intercepts nothing: wheel input keeps its usual meaning and
      // scrolls the page vertically (smoothly, via Lenis).
      expect(after).toBeGreaterThan(before);
    });

    test("does not let a pointer drag steer the strip", async ({ page }) => {
      await page.goto("/");
      const track = page.locator("[data-carousel]");
      await expect(track).toHaveClass(/is-enhanced/, { timeout: 10_000 });
      await track.scrollIntoViewIfNeeded();

      const box = await track.boundingBox();
      if (!box) throw new Error("carousel track has no layout box");
      const firstSlide = page.locator(".landing-slide").first();
      const startLeft = (await firstSlide.boundingBox())?.x ?? 0;

      const midY = box.y + box.height / 2;
      await page.mouse.move(box.x + box.width * 0.7, midY);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.7 - 100, midY, { steps: 4 });
      await page.mouse.move(box.x + box.width * 0.7 - 300, midY, { steps: 8 });
      const draggedLeft = (await firstSlide.boundingBox())?.x ?? 0;
      await page.mouse.up();

      // No Draggable, no inertia: the 300px pointer travel must not become
      // strip travel. Only the autonomous loop moves it (~60px/s), so anything
      // near the drag distance is a regression.
      const travelled = startLeft - draggedLeft;
      expect(travelled).toBeGreaterThan(0);
      expect(travelled).toBeLessThan(150);
    });

    test("keeps the strip a static, non-interactive presentation under reduced motion", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      const track = page.locator("[data-carousel]");
      await expect(track).not.toHaveClass(/is-enhanced/);
      await track.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);

      const firstSlide = page.locator(".landing-slide").first();
      const before = (await firstSlide.boundingBox())?.x ?? 0;
      await page.waitForTimeout(1200);
      const after = (await firstSlide.boundingBox())?.x ?? 0;

      // Static: no autonomous loop, no transform drift of any kind.
      expect(Math.abs(after - before)).toBeLessThan(1);
      // Still presentation-only: clicking a slide opens nothing.
      await firstSlide.click({ position: { x: 20, y: 20 } });
      await expect(page.locator("[role='dialog']")).toHaveCount(0);
    });
  });

  /**
   * The hero dropped its own brand mark ("Tenis de Mesa · Cata Club") because
   * the navbar lockup right above it already names the club. Deleting an
   * element is the easy half; the space it occupied is the half that regresses.
   *
   * Neither viewport can be reasoned about from the other, because the hero is
   * a different layout in each:
   *
   *   - Desktop is a two-column grid whose height is set by the photo frame
   *     (`aspect-ratio: 6/5` over its own column), NOT by the copy. So the copy
   *     column cannot shrink the hero — it just floats, vertically centred,
   *     inside a band it no longer fills. Removing 62px of copy turned ~58px of
   *     slack above and below into ~89px: that is the "empty gap" this measures.
   *     The fix is the responsive `gap` on `.landing-hero-copy`, which hands the
   *     reclaimed height back to the copy's own rhythm.
   *   - Mobile stacks the same grid into rows, so the copy's height IS the row's
   *     height and no slack can open at all. The risk there is the opposite one:
   *     with the brand gone the headline sat 64px under a sticky navbar and
   *     crowded it, so the hero's top padding absorbs part of the reclaim.
   *
   * Both numbers are measured in a real browser after layout and fonts settle.
   * jsdom computes none of this — it has no box model for `aspect-ratio`,
   * `clamp()` or grid — which is why these assertions live here and not in
   * `LandingPage.test.tsx`.
   */
  test.describe("hero spacing after the duplicate brand was removed", () => {
    /** Hero box metrics that only exist once a real engine has laid it out. */
    const measureHero = async (page: import("@playwright/test").Page) => {
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);
      await page.locator(".landing-hero h1").waitFor();
      return page.evaluate(() => {
        const hero = document.querySelector(".landing-hero") as HTMLElement;
        const copy = document.querySelector(".landing-hero-copy") as HTMLElement;
        const frame = document.querySelector(".landing-hero-frame") as HTMLElement;
        const headline = hero.querySelector("h1") as HTMLElement;
        const heroStyle = getComputedStyle(hero);
        const heroBox = hero.getBoundingClientRect();
        const copyBox = copy.getBoundingClientRect();
        // The hero's content box: what the two grid columns actually share.
        const contentTop = heroBox.top + parseFloat(heroStyle.paddingTop);
        const contentBottom = heroBox.bottom - parseFloat(heroStyle.paddingBottom);
        return {
          heroText: hero.textContent ?? "",
          brandCount: hero.querySelectorAll(".landing-hero-brand").length,
          copyRowGap: parseFloat(getComputedStyle(copy).rowGap),
          contentHeight: contentBottom - contentTop,
          copyHeight: copyBox.height,
          slackAbove: copyBox.top - contentTop,
          slackBelow: contentBottom - copyBox.bottom,
          headlineInset: headline.getBoundingClientRect().top - heroBox.top,
          copyToFrame: frame.getBoundingClientRect().top - copyBox.bottom,
        };
      });
    };

    test("closes the desktop slack instead of leaving a hole where the brand was", async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const hero = await measureHero(page);

      expect(hero.brandCount).toBe(0);
      expect(hero.heroText).not.toMatch(/tenis de mesa/i);

      // The mechanism: the copy's internal rhythm opens up on wide viewports so
      // the column keeps its presence. At 22px (the old flat value) the numbers
      // below cannot hold once the brand is gone.
      expect(hero.copyRowGap).toBeGreaterThanOrEqual(36);

      // The outcome: measured slack stays at the pre-removal ~58px rather than
      // ballooning to ~89px, and stays even top-to-bottom.
      expect(hero.slackAbove).toBeLessThanOrEqual(64);
      expect(hero.slackBelow).toBeLessThanOrEqual(64);
      expect(Math.abs(hero.slackAbove - hero.slackBelow)).toBeLessThanOrEqual(2);
      // Same statement as a ratio, so a future taller frame cannot pass by
      // growing the band while the copy stands still.
      expect(hero.copyHeight / hero.contentHeight).toBeGreaterThanOrEqual(0.74);
    });

    test("keeps the mobile headline clear of the navbar without reopening the gap", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const hero = await measureHero(page);

      expect(hero.brandCount).toBe(0);
      expect(hero.heroText).not.toMatch(/tenis de mesa/i);

      // Stacked, there is no band to fill, so the desktop widening must not
      // leak down here and push the copy apart.
      expect(hero.copyRowGap).toBeLessThanOrEqual(24);

      // The headline breathes under the sticky navbar (floor) without
      // re-creating the void the brand used to fill (ceiling).
      expect(hero.headlineInset).toBeGreaterThanOrEqual(72);
      expect(hero.headlineInset).toBeLessThanOrEqual(100);

      // And the copy still meets the photo on the grid's own row gap — no
      // second hole opening between the two stacked halves.
      expect(hero.copyToFrame).toBeGreaterThanOrEqual(36);
      expect(hero.copyToFrame).toBeLessThanOrEqual(44);
    });
  });

  /**
   * The paddle under the hero's serve ball (issue #640).
   *
   * Two separate claims live here and neither implies the other:
   *
   *   - WHERE the paddle is. Measured through `offsetLeft`/`offsetTop`, which
   *     are layout values and therefore blind to the transforms GSAP writes —
   *     a sample taken mid-flight reads the same as one taken at rest. Both
   *     elements are direct children of `.landing-hero`, so they share one
   *     offset parent and the numbers are directly comparable.
   *   - WHEN the paddle is square to the ball. That one cannot be measured from
   *     a still: it is a relationship over time, so the real timeline is
   *     sampled frame by frame in the real browser and the pair is checked at
   *     the frames where contact actually happens. A paddle that had drifted
   *     out of phase would still be in the right PLACE — it would simply be
   *     swinging at nothing — which is why the geometry test cannot stand in
   *     for this one.
   *
   * `landing-serve.test.ts` proves the same phase lock against the timeline's
   * own clock; what this adds is that the browser really runs it, at a real
   * viewport, inside the hero's bounds.
   */
  test.describe("hero serve paddle", () => {
    /** The two layouts the hero actually has: a two-column grid, and stacked. */
    const VIEWPORTS = [
      { name: "desktop", width: 1440, height: 900 },
      { name: "phone", width: 390, height: 844 },
    ];

    /** Transform-blind layout facts about the ball/paddle pair. */
    const measureServe = (page: import("@playwright/test").Page) =>
      page.evaluate(() => {
        const hero = document.querySelector(".landing-hero") as HTMLElement;
        const ball = document.querySelector("[data-serve-ball]") as HTMLElement;
        const paddle = document.querySelector("[data-serve-paddle]") as HTMLElement;
        const root = document.documentElement;
        return {
          // Comparable offsets require one shared offset parent, so this is a
          // precondition of every number below rather than a nicety.
          sharedOffsetParent: ball.offsetParent === hero && paddle.offsetParent === hero,
          ballCentreX: ball.offsetLeft + ball.offsetWidth / 2,
          paddleCentreX: paddle.offsetLeft + paddle.offsetWidth / 2,
          // Negative = the ball rests slightly into the face, which is contact.
          contactGap: paddle.offsetTop - (ball.offsetTop + ball.offsetHeight),
          ballWidth: ball.offsetWidth,
          paddleWidth: paddle.offsetWidth,
          paddleBottomInHero: hero.clientHeight - (paddle.offsetTop + paddle.offsetHeight),
          pageOverflowPx: root.scrollWidth - root.clientWidth,
        };
      });

    /**
     * Records the live serve for ~1.6s — more than one full cycle — reading the
     * transforms the motion layer writes, never the classes it sets.
     */
    const sampleServe = (page: import("@playwright/test").Page) =>
      page.evaluate(
        () =>
          new Promise<{ ty: number; rot: number; ballTopInHero: number }[]>((resolve) => {
            const hero = document.querySelector(".landing-hero") as HTMLElement;
            const ball = document.querySelector("[data-serve-ball]") as HTMLElement;
            const paddle = document.querySelector("[data-serve-paddle]") as HTMLElement;
            // `transform: none` is not a matrix string — DOMMatrix rejects it.
            const matrixOf = (element: HTMLElement): DOMMatrixReadOnly => {
              const value = getComputedStyle(element).transform;
              return value === "none" ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(value);
            };
            const samples: { ty: number; rot: number; ballTopInHero: number }[] = [];
            const started = performance.now();
            const tick = (now: number): void => {
              const paddleMatrix = matrixOf(paddle);
              samples.push({
                ty: matrixOf(ball).m42,
                rot: (Math.atan2(paddleMatrix.b, paddleMatrix.a) * 180) / Math.PI,
                ballTopInHero:
                  ball.getBoundingClientRect().top - hero.getBoundingClientRect().top,
              });
              if (now - started >= 1600) resolve(samples);
              else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }),
      );

    /** Resolves once the motion layer has loaded and is actually moving the ball. */
    const waitForServe = async (page: import("@playwright/test").Page): Promise<void> => {
      await page.waitForFunction(
        () => {
          const ball = document.querySelector("[data-serve-ball]");
          if (!ball) return false;
          const value = getComputedStyle(ball).transform;
          return value !== "none" && value !== "matrix(1, 0, 0, 1, 0, 0)";
        },
        null,
        { timeout: 20_000 },
      );
    };

    for (const viewport of VIEWPORTS) {
      test(`stands the paddle under the ball's path on ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto("/");
        await page.locator("[data-serve-paddle]").waitFor();
        const serve = await measureServe(page);

        expect(serve.sharedOffsetParent).toBe(true);
        // On the ball's own vertical axis: the trajectory is straight up, so
        // "aligned with the path" is exactly "same centre".
        expect(Math.abs(serve.ballCentreX - serve.paddleCentreX)).toBeLessThanOrEqual(1);
        // Beneath it, and touching — not floating below with a gap, and not
        // swallowing the ball either.
        expect(serve.contactGap).toBeGreaterThanOrEqual(-4);
        expect(serve.contactGap).toBeLessThanOrEqual(6);
        // A face the ball could actually be struck by.
        expect(serve.paddleWidth).toBeGreaterThan(serve.ballWidth);
        // Clear of the hero's bottom edge, so the whole paddle is on screen.
        expect(serve.paddleBottomInHero).toBeGreaterThanOrEqual(12);
        expect(serve.pageOverflowPx).toBeLessThanOrEqual(0);
      });

      test(`keeps ball and paddle in phase on ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto("/");
        await waitForServe(page);
        const samples = await sampleServe(page);

        const apex = samples.reduce((lowest, sample) => (sample.ty < lowest.ty ? sample : lowest));
        // The serve really runs — without this the checks below are vacuous.
        expect(apex.ty).toBeLessThanOrEqual(-60);
        // ...and the paddle is swung away while the ball is up there.
        expect(Math.abs(apex.rot)).toBeGreaterThanOrEqual(10);

        // Every frame where the ball is on the face, the face is square to it.
        const contacts = samples.filter((sample) => Math.abs(sample.ty) <= 6);
        expect(contacts.length).toBeGreaterThanOrEqual(3);
        const offSquare = contacts.filter((sample) => Math.abs(sample.rot) > 3);
        expect(offSquare).toEqual([]);

        // ...and the mirror of it: a paddle sitting square while the ball is
        // still in the air has finished its swing early and is waiting at a
        // contact that has not happened. Checking only the frames above would
        // pass that, because those frames would look perfect.
        const idleInFlight = samples.filter(
          (sample) => Math.abs(sample.ty) > 10 && Math.abs(sample.rot) <= 0.5,
        );
        expect(idleInFlight).toEqual([]);

        // The flight stays inside the hero: `overflow: hidden` would otherwise
        // hide the top of the arc instead of failing.
        const highest = Math.min(...samples.map((sample) => sample.ballTopInHero));
        expect(highest).toBeGreaterThanOrEqual(0);
      });

      test(`holds the still composition under reduced motion on ${viewport.name}`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto("/");
        await page.locator("[data-serve-paddle]").waitFor();

        // Nothing moves...
        const transforms = await page.evaluate(() => {
          const flat = (selector: string): string => {
            const value = getComputedStyle(document.querySelector(selector) as HTMLElement).transform;
            return value === "none" ? "matrix(1, 0, 0, 1, 0, 0)" : value;
          };
          return { ball: flat("[data-serve-ball]"), paddle: flat("[data-serve-paddle]") };
        });
        expect(transforms.ball).toBe("matrix(1, 0, 0, 1, 0, 0)");
        expect(transforms.paddle).toBe("matrix(1, 0, 0, 1, 0, 0)");

        // ...and what is left standing is the hit itself: the ball at rest on a
        // square face, which is the same frame the animation passes through.
        const serve = await measureServe(page);
        expect(Math.abs(serve.ballCentreX - serve.paddleCentreX)).toBeLessThanOrEqual(1);
        expect(serve.contactGap).toBeGreaterThanOrEqual(-4);
        expect(serve.contactGap).toBeLessThanOrEqual(6);
        expect(serve.pageOverflowPx).toBeLessThanOrEqual(0);
      });
    }

    test("carries the club crest on the paddle face", async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");

      const crest = page.locator("[data-serve-paddle] img");
      // `cata-club-crest-256.png`, not `.../_next/image?url=...`: issue #681,
      // see the "never asks the image optimizer" lock below this test — this
      // is the plain static asset path, unwrapped, because that lock is what
      // keeps this asset off the one route that was ever proven to hang.
      await expect(crest).toHaveAttribute("src", "/brand/cata-club-crest-256.png");

      // `toBeVisible` only proves CSS visibility. The bytes have to have
      // arrived before `naturalWidth` means anything, or a lazy image reports 0
      // and every ratio computed from it comes out NaN.
      //
      // The scroll goes through `evaluate` rather than `scrollIntoViewIfNeeded`
      // because that helper waits for the element to be STABLE, and this one
      // lives inside a paddle that is never still — it retried itself to a
      // timeout. `evaluate` runs no actionability check, so the guard survives
      // the very animation this suite exists to assert.
      await crest.evaluate((image: HTMLImageElement) => {
        image.scrollIntoView({ block: "center" });
        return (
          image.complete ||
          new Promise((resolve, reject) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", reject, { once: true });
          })
        );
      });
      const drawn = await crest.evaluate((image: HTMLImageElement) => ({
        naturalWidth: image.naturalWidth,
        rendered: image.getBoundingClientRect().width,
      }));

      expect(drawn.naturalWidth).toBeGreaterThan(0);
      expect(drawn.rendered).toBeGreaterThan(0);
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
