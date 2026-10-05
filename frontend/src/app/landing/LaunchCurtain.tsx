"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { countdownParts, countdownSpeech, isCountdownVisible, padUnit } from "@/lib/launch";
import { startFireworks } from "./fireworks";

type Phase = "closed" | "opening" | "done";

/** How long the curtains take to part (CSS `--launch-open` must match). */
export const OPEN_MS = 2200;
export const REDUCED_OPEN_MS = 900;
export const FIREWORKS_MS = 6500;

const UNITS = [
  ["days", "Días"],
  ["hours", "Horas"],
  ["minutes", "Minutos"],
  ["seconds", "Segundos"],
] as const;

interface LaunchCurtainProps {
  /** Epoch ms of the launch, resolved on the server (`resolveLaunchAt`). */
  launchAt: number;
  /** Epoch ms of the server render; the first paint is decided from it. */
  serverNow: number;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Pre-launch curtain for the landing home. The server decides whether it is
 * rendered at all (`serverNow` vs. `launchAt`), so visitors after the launch
 * get no overlay and no flash; the client then counts down from `Date.now()`
 * on every tick, which makes sleeping tabs catch up on wake.
 */
export default function LaunchCurtain({ launchAt, serverNow }: LaunchCurtainProps): React.ReactElement | null {
  const [phase, setPhase] = useState<Phase>(serverNow < launchAt ? "closed" : "done");
  const [remaining, setRemaining] = useState(Math.max(0, launchAt - serverNow));
  const [reduced, setReduced] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [forcedPublic, setForcedPublic] = useState(false);
  const [viewAsPublic, setViewAsPublic] = useState(false);
  const { session } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastAnnouncedMinute = useRef<number | null>(null);

  // The club team (an ADMINISTRADOR session) previews the landing without the
  // curtains until launch; `?cortinas=1` forces the public view for anyone.
  const bypass = session?.user.role === "admin" && !forcedPublic && !viewAsPublic;
  const bypassRef = useRef(bypass);
  bypassRef.current = bypass;

  useEffect(() => {
    setForcedPublic(new URLSearchParams(window.location.search).get("cortinas") === "1");
  }, []);

  // Tick while closed. Recomputed from the wall clock each time.
  useEffect(() => {
    if (phase !== "closed") return undefined;
    const tick = (): void => {
      const left = launchAt - Date.now();
      if (left <= 0) {
        setReduced(prefersReducedMotion());
        setRemaining(0);
        // A previewing admin already sees the landing: no show, just no banner.
        setPhase(bypassRef.current ? "done" : "opening");
        return;
      }
      setRemaining(left);
      const minute = Math.floor(left / 60_000);
      if (isCountdownVisible(left) && lastAnnouncedMinute.current !== minute) {
        lastAnnouncedMinute.current = minute;
        setAnnouncement(`Faltan ${countdownSpeech(countdownParts(left))} para el lanzamiento.`);
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [phase, launchAt]);

  // The page behind stays inert and unscrollable while the curtains are shut.
  const sealed = phase === "closed" && !bypass;
  useEffect(() => {
    if (!sealed) return undefined;
    const content = document.querySelector("[data-launch-content]");
    content?.setAttribute("inert", "");
    document.documentElement.classList.add("launch-locked");
    return () => {
      content?.removeAttribute("inert");
      document.documentElement.classList.remove("launch-locked");
    };
  }, [sealed]);

  // Opening: fireworks (unless reduced motion), then remove the overlay.
  useEffect(() => {
    if (phase !== "opening") return undefined;
    const stopFireworks = !reduced && canvasRef.current ? startFireworks(canvasRef.current, FIREWORKS_MS) : () => {};
    const id = window.setTimeout(() => setPhase("done"), reduced ? REDUCED_OPEN_MS : FIREWORKS_MS);
    return () => {
      window.clearTimeout(id);
      stopFireworks();
    };
  }, [phase, reduced]);

  if (phase === "done") return null;

  if (bypass) {
    return (
      <aside className="launch-preview" aria-label="Vista previa de la landing">
        <p>Vista previa: el público ve las cortinas hasta las 17:00</p>
        <button type="button" onClick={() => setViewAsPublic(true)}>Ver como el público</button>
      </aside>
    );
  }

  const counting = isCountdownVisible(remaining);
  const parts = countdownParts(remaining);
  return (
    <div
      className={`launch-curtain${phase === "opening" ? " is-opening" : ""}${reduced ? " is-reduced" : ""}`}
      role={phase === "closed" ? "dialog" : undefined}
      aria-modal={phase === "closed" ? true : undefined}
      aria-label="Cuenta regresiva para el gran lanzamiento de Cata Club"
      data-testid="launch-curtain"
    >
      <div className="launch-panel launch-panel-left" aria-hidden="true" />
      <div className="launch-panel launch-panel-right" aria-hidden="true" />
      <div className="launch-valance" aria-hidden="true" />
      <div className="launch-stage">
        <Image className="launch-crest" src="/brand/cata-club-crest-256.png" alt="" width={112} height={112} unoptimized priority />
        <p className={`launch-kicker${counting ? "" : " launch-kicker-soon"}`}>
          {counting ? "Gran lanzamiento · hoy 17:00" : "Muy pronto · hoy 17:00"}
        </p>
        {counting && (
          <div className="launch-clock" aria-hidden="true">
            {UNITS.map(([key, label]) => (
              <div className="launch-unit" key={key}>
                <b>{padUnit(parts[key])}</b>
                <span>{label}</span>
              </div>
            ))}
          </div>
        )}
        <p className="launch-sr" role="status" aria-live="polite">{announcement}</p>
      </div>
      {viewAsPublic && phase === "closed" && (
        <button type="button" className="launch-exit" onClick={() => setViewAsPublic(false)}>Salir de la vista pública</button>
      )}
      <canvas ref={canvasRef} className="launch-fireworks" aria-hidden="true" />
    </div>
  );
}
