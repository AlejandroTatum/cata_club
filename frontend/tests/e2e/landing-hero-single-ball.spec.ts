/**
 * Lock — the hero must show exactly one ball.
 *
 * Reported from a live review of the hero, not from an issue. The hero draws
 * a real serve ball (`[data-serve-ball]`, ~26-38px, white, the one
 * `landing-serve.ts` animates onto the paddle face) and the paddle shape
 * itself drew a second one: `.landing-paddle::after`, a 13px white dot pinned
 * to the top-right of the face. Measured at 1440x900 the dot rendered inside
 * the paddle's box while the real ball sat just above it, so the hero read as
 * two balls instead of one shot.
 *
 * The fix scopes the dot away from the hero paddle only. On the Motto CTA
 * paddle there is no other ball, and paddle-plus-ball is the sport's own
 * icon — so this suite checks both halves. The Motto assertion is not a
 * courtesy: it is what the scoping exists to protect, and it is what fails if
 * someone later deletes the base rule instead of overriding it.
 *
 * Counted, not eyeballed: the browser is asked for every element and every
 * `::before`/`::after` inside the hero, and the ones that actually render as
 * a white circle are tallied. A screenshot cannot tell you there is exactly
 * one.
 */
import { test, expect, type Page } from "@playwright/test";

interface BallCount {
  balls: string[];
  serveBallPresent: boolean;
}

/**
 * Tallies everything inside the hero that renders as a white circle — the
 * element itself and both pseudo-elements, since the dot at issue was a
 * pseudo and would be invisible to any DOM-only count.
 *
 * White specifically, on the surface token: `.landing-hero-frameball` is also
 * a small circle but it is the photo frame's orange accent, not a table
 * tennis ball, and it was never part of the complaint. Both things this
 * counts were white, 38px and 13px, one above the other.
 */
async function countHeroBalls(page: Page): Promise<BallCount> {
  return page.evaluate((): BallCount => {
    const hero = document.querySelector(".landing-hero");
    if (!hero) throw new Error("no hero");
    // `--landing-surface` is declared on `.landing-page`, not `:root`, so it
    // has to be read from there — off the document element it comes back
    // empty and nothing would ever match.
    const scope = document.querySelector(".landing-page") ?? document.documentElement;
    const surface = getComputedStyle(scope).getPropertyValue("--landing-surface").trim();
    // Resolve the token to the rgb() string computed styles actually report.
    const probe = document.createElement("span");
    probe.style.color = surface || "#fff";
    document.body.append(probe);
    const surfaceRgb = getComputedStyle(probe).color;
    probe.remove();

    const isBall = (style: CSSStyleDeclaration, rendered: boolean): boolean => {
      if (!rendered) return false;
      if (!style.borderRadius.startsWith("50%")) return false;
      if (style.backgroundColor !== surfaceRgb) return false;
      const width = Number.parseFloat(style.width);
      return Number.isFinite(width) && width > 0 && width < 60;
    };

    const balls: string[] = [];
    let serveBallPresent = false;
    for (const node of [hero, ...Array.from(hero.querySelectorAll("*"))]) {
      const element = node as HTMLElement;
      const own = getComputedStyle(element);
      const visible = own.display !== "none" && own.visibility !== "hidden" && own.opacity !== "0";
      const label = `${element.tagName.toLowerCase()}.${element.className || "-"}`;
      if (isBall(own, visible && element.getBoundingClientRect().width > 0)) {
        balls.push(label);
        if (element.hasAttribute("data-serve-ball")) serveBallPresent = true;
      }
      for (const pseudo of ["::before", "::after"]) {
        const style = getComputedStyle(element, pseudo);
        if (isBall(style, visible && style.content !== "none")) balls.push(`${label}${pseudo}`);
      }
    }
    return { balls, serveBallPresent };
  });
}

test.describe("hero shows one ball, Motto keeps its dot", () => {
  test("at rest and mid-serve, the hero renders exactly one ball", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.locator("[data-serve-paddle]").waitFor();

    const atRest = await countHeroBalls(page);
    expect(atRest.balls).toHaveLength(1);
    // The one that survives must be the animated serve ball, not the dot.
    expect(atRest.serveBallPresent).toBe(true);

    // The paddle's own dot is what used to be the second one; it must not
    // render on this paddle at all.
    const heroPaddleDot = await page.locator("[data-serve-paddle]").evaluate((node) =>
      getComputedStyle(node, "::after").content,
    );
    expect(heroPaddleDot).toBe("none");

    // Mid-animation: `landing-serve.ts` puts ball and paddle on one timeline,
    // and a transform must not conjure a second circle.
    await page.waitForTimeout(1_800);
    const midServe = await countHeroBalls(page);
    expect(midServe.balls).toHaveLength(1);
    expect(midServe.serveBallPresent).toBe(true);
  });

  test("the Motto paddle keeps the dot that is its only ball", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const motto = page.locator("[data-motto-paddle]");
    await motto.scrollIntoViewIfNeeded();
    await expect(motto).toBeVisible();

    const dot = await motto.evaluate((node) => {
      const style = getComputedStyle(node, "::after");
      return { content: style.content, width: style.width, height: style.height, radius: style.borderRadius };
    });

    expect(dot.content).not.toBe("none");
    expect(dot.width).toBe("13px");
    expect(dot.height).toBe("13px");
    expect(dot.radius.startsWith("50%")).toBe(true);
  });

  test("under reduced motion the still frame is still one ball on the face", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto("/");
    await page.locator("[data-serve-paddle]").waitFor();

    const still = await countHeroBalls(page);
    expect(still.balls).toHaveLength(1);
    expect(still.serveBallPresent).toBe(true);

    // `landing.css` pins both to `opacity: 1; transform: none` under this
    // query, so the ball must be standing square on the paddle face — that
    // still frame is what states what the animation would have shown.
    const geometry = await page.evaluate(() => {
      const ball = document.querySelector("[data-serve-ball]")?.getBoundingClientRect();
      const paddle = document.querySelector("[data-serve-paddle]")?.getBoundingClientRect();
      if (!ball || !paddle) return null;
      return {
        centresAligned: Math.abs((ball.left + ball.right) / 2 - (paddle.left + paddle.right) / 2) <= 2,
        restingOnFace: Math.abs(ball.bottom - paddle.top) <= 4,
      };
    });

    expect(geometry?.centresAligned).toBe(true);
    expect(geometry?.restingOnFace).toBe(true);

    await context.close();
  });
});
