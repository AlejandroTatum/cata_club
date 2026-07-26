/**
 * Landing page E2E smoke test.
 *
 * Verifies the landing page renders correctly and the main CTA navigates
 * to the login page. This is deterministic and uses semantic queries only.
 *
 * The hero was rewritten: the page's single `<h1>` used to be the club's name
 * and is now its promise ("FORMANDO CAMPEONES PARA LA VIDA"), with the name
 * demoted to the brand mark and the kicker above the headline. Both halves of
 * what the old assertion protected are still checked — the hero renders its
 * headline, AND the page still identifies the club — they are just two
 * elements now instead of one.
 */

import { test, expect } from "@playwright/test";

test.describe("Landing page", () => {
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

    test("moves the strip exactly as far as the pointer drags it", async ({ page }) => {
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

      // Converting drag pixels to timeline progress against anything but the
      // full loop width makes the strip outrun the pointer.
      const travelled = startLeft - draggedLeft;
      expect(travelled).toBeGreaterThan(240);
      expect(travelled).toBeLessThan(360);
    });
  });
});
