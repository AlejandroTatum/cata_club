/**
 * The in-page contrast instrument shared by the role sweep and the public-page
 * theme spec: `scanContrast` runs INSIDE the page (hand it to `page.evaluate`),
 * so it must stay self-contained — no imports, no references to this module.
 *
 * Text nodes are held to WCAG 1.4.3 (4.5:1, 3:1 for large text) and Lucide
 * icons to 1.4.11 (3:1) against the backdrop they are drawn on; anything on a
 * gradient or image is skipped and counted. Two declared exceptions: text inside
 * an `aria-hidden` subtree is decoration (WCAG 1.4.3 exempts it), and an element
 * under `data-contrast-backdrop="#rrggbb"` is measured against that colour, for
 * text laid over a clipped sibling shape the ancestor walk cannot see.
 */

export interface Failure {
  selector: string;
  text: string;
  fg: string;
  bg: string;
  ratio: number;
  required: number;
  font: string;
}

/** Runs in the page: returns every text node whose contrast is below its bar. */
export function scanContrast(): { failures: Failure[]; checked: number; skipped: number; iconsChecked: number } {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  type RGBA = [number, number, number, number];
  const cache = new Map<string, RGBA>();
  function parse(css: string): RGBA {
    const hit = cache.get(css);
    if (hit) return hit;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    // getImageData returns premultiplied-undone 8-bit values; alpha is exact enough.
    const out: RGBA = [d[0], d[1], d[2], d[3] / 255];
    cache.set(css, out);
    return out;
  }
  function blend(top: RGBA, under: [number, number, number]): [number, number, number] {
    const a = top[3];
    return [
      top[0] * a + under[0] * (1 - a),
      top[1] * a + under[1] * (1 - a),
      top[2] * a + under[2] * (1 - a),
    ];
  }
  function lum(c: [number, number, number]): number {
    const f = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  }
  const hex = (c: number[]): string =>
    "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

  /** Backdrop under `el`: layers bottom-up until the first opaque one. */
  function backdrop(el: Element): { rgb: [number, number, number]; unknown: boolean } {
    const declared = el.closest("[data-contrast-backdrop]")?.getAttribute("data-contrast-backdrop");
    if (declared) {
      const c = parse(declared);
      return { rgb: [c[0], c[1], c[2]], unknown: false };
    }
    const layers: RGBA[] = [];
    let node: Element | null = el;
    let unknown = false;
    let opaque = false;
    while (node) {
      const cs = getComputedStyle(node);
      if (cs.backgroundImage !== "none" && /gradient|url/.test(cs.backgroundImage)) {
        // A gradient or image paints behind the text: its colour is not a single value.
        unknown = true;
        break;
      }
      const bg = parse(cs.backgroundColor);
      if (bg[3] > 0) {
        layers.push(bg);
        if (bg[3] >= 0.995) {
          opaque = true;
          break;
        }
      }
      node = node.parentElement;
    }
    let rgb: [number, number, number] = opaque ? [layers[layers.length - 1][0], layers[layers.length - 1][1], layers[layers.length - 1][2]] : [255, 255, 255];
    const start = opaque ? layers.length - 2 : layers.length - 1;
    for (let i = start; i >= 0; i--) rgb = blend(layers[i], rgb);
    return { rgb, unknown };
  }

  function describe(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;
    for (let depth = 0; node && node !== document.body && depth < 4; depth++) {
      const cls = (node.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 4).join(".");
      parts.unshift(node.tagName.toLowerCase() + (node.id ? `#${node.id}` : "") + (cls ? `.${cls}` : ""));
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  const failures: Failure[] = [];
  const seen = new Set<string>();
  let checked = 0;
  let skipped = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.nodeValue ?? "").replace(/\s+/g, " ").trim();
    const el = n.parentElement;
    if (!text || !el) continue;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(el.tagName)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== "visible" || cs.display === "none") continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rect = range.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    // Disabled controls are exempt (WCAG 1.4.3 incidental).
    if (el.closest(":disabled, [aria-disabled='true']")) continue;
    // Next's dev/route announcer and the Next error overlay are not product UI.
    if (el.closest("next-route-announcer, nextjs-portal")) continue;
    // Purely decorative copy (the empty state's ghost cards) is exempt.
    if (el.closest("[aria-hidden='true']")) continue;

    let opacity = 1;
    for (let a: Element | null = el; a; a = a.parentElement) opacity *= Number(getComputedStyle(a).opacity);
    if (opacity < 0.05) continue;

    const { rgb: bg, unknown } = backdrop(el);
    if (unknown) {
      skipped++;
      continue;
    }
    const fgRaw = parse(cs.color);
    const fgRgb = blend([fgRaw[0], fgRaw[1], fgRaw[2], fgRaw[3] * opacity], bg);
    const l1 = lum(fgRgb);
    const l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = px >= 24 || (px >= 18.66 && bold);
    const required = large ? 3 : 4.5;
    checked++;
    if (ratio + 1e-6 >= required) continue;
    const selector = describe(el);
    const key = selector + hex(fgRgb) + hex(bg);
    if (seen.has(key)) continue;
    seen.add(key);
    failures.push({
      selector,
      text: text.slice(0, 40),
      fg: hex(fgRgb),
      bg: hex(bg),
      ratio: Math.round(ratio * 100) / 100,
      required,
      font: `${px}px/${cs.fontWeight}`,
    });
  }

  // Non-text UI: Lucide icons draw with `currentColor` strokes, so the element's
  // computed colour is the ink and the same backdrop walk finds its ground.
  let iconsChecked = 0;
  for (const icon of Array.from(document.querySelectorAll<SVGElement>("svg.lucide"))) {
    const cs = getComputedStyle(icon);
    if (cs.visibility !== "visible" || cs.display === "none") continue;
    const rect = icon.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    if (icon.closest(":disabled, [aria-disabled='true'], next-route-announcer, nextjs-portal")) continue;
    let opacity = 1;
    for (let a: Element | null = icon; a; a = a.parentElement) opacity *= Number(getComputedStyle(a).opacity);
    if (opacity < 0.05) continue;
    const { rgb: bg, unknown } = backdrop(icon);
    if (unknown) {
      skipped++;
      continue;
    }
    const stroke = cs.stroke === "currentcolor" || cs.stroke === "currentColor" || cs.stroke === "none" ? cs.color : cs.stroke;
    const fgRaw = parse(stroke);
    const fgRgb = blend([fgRaw[0], fgRaw[1], fgRaw[2], fgRaw[3] * opacity], bg);
    const l1 = lum(fgRgb);
    const l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    iconsChecked++;
    if (ratio + 1e-6 >= 3) continue;
    const selector = describe(icon);
    const key = "icon" + selector + hex(fgRgb) + hex(bg);
    if (seen.has(key)) continue;
    seen.add(key);
    failures.push({
      selector,
      text: "(icon)",
      fg: hex(fgRgb),
      bg: hex(bg),
      ratio: Math.round(ratio * 100) / 100,
      required: 3,
      font: `${Math.round(rect.width)}px icon`,
    });
  }
  return { failures, checked, skipped, iconsChecked };
}
