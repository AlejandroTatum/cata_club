"use client";

import { useEffect, useState } from "react";
import { cn } from "@/components/ui/cn";

export interface LegalTocItem {
  id: string;
  label: string;
}

/**
 * "En este documento": the section links of a legal document, with the section
 * being read marked. The links are plain anchors, so the list works before (and
 * without) hydration; the observer only adds `aria-current` and the highlight.
 */
export default function LegalToc({ items }: { items: readonly LegalTocItem[] }): React.ReactElement {
  const [active, setActive] = useState<string>(items[0]?.id ?? "");

  useEffect(() => {
    const targets = items.map((item) => document.getElementById(item.id)).filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0 || typeof IntersectionObserver === "undefined") return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        // The first visible heading in document order is the section being read.
        const first = items.find((item) => visible.has(item.id));
        if (first !== undefined) setActive(first.id);
      },
      // A band across the upper part of the viewport, below the sticky bar.
      { rootMargin: "-96px 0px -60% 0px" },
    );
    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav aria-label="En este documento" className="card p-5">
      <p className="mb-3 text-2xs font-extrabold uppercase tracking-caps text-ink-3-strong">En este documento</p>
      <ol className="grid gap-1 text-sm">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={active === item.id ? "location" : undefined}
              className={cn(
                "block border-l-2 py-1 pl-3 leading-snug transition-colors",
                active === item.id ? "border-cata-red font-semibold text-cata-text" : "border-transparent text-ink-2 hover:text-cata-text",
              )}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
