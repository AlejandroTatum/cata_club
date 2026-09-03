"use client";

/**
 * PÁGINA TEMPORAL DE DIAGNÓSTICO — issue de los diálogos de `/members` que
 * solo se reproduce en Safari de iOS: el cuerpo del diálogo colapsa, el
 * diálogo ocupa un tercio de la pantalla, y header y pie se ven bien. Van
 * TRES intentos de arreglo fallidos, todos razonados sobre WebKit sin
 * medirlo nunca. Verificado en WebKit real (contenedor de Playwright, 4
 * viewports, los dos caminos de código) y NO se reproduce ahí: sale
 * correcto siempre. Lo único sin cubrir es lo que solo existe en el
 * dispositivo real — esta página es el instrumento para medirlo.
 *
 * NO arregla nada: solo abre el diálogo real (mismas clases, mismo hook que
 * `/members`) y vuelca en pantalla las medidas de layout que un dispositivo
 * físico puede dar y un contenedor headless no. Sin autenticación a
 * propósito: el dueño la abre directo en su iPhone.
 *
 * BORRAR esta página (y su test) cuando el defecto de iOS quede cerrado.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { NATIVE_DIALOG_SHELL_CLASS, NATIVE_DIALOG_BODY_CLASS, useNativeDialog } from "@/app/members/useNativeDialog";
import { ICON } from "@/lib/icon-size";

/** Cuántos párrafos de relleno lleva el cuerpo — fuerza scroll interno, igual que el ~1132px real de Editar miembro. */
const FILLER_PARAGRAPH_COUNT = 40;

/** Una línea del panel de lectura: etiqueta en español + valor ya formateado. */
interface MeasurementLine {
  label: string;
  value: string;
}

/** Formatea un número a píxeles con un decimal, o "N/D" si no es finito. */
function px(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "N/D";
  return `${value.toFixed(1)}px`;
}

/**
 * Longitudes CSS que no se pueden leer con `getComputedStyle` directamente
 * sobre `env(...)` o sobre una unidad de viewport: hace falta un elemento
 * real con esa longitud aplicada y leer su caja ya resuelta. Los ocho `div`
 * que monta viven ocultos (clip, sin pintar) pero SÍ reciben layout — un
 * `display: none` no serviría, ahí el navegador nunca resuelve la longitud.
 */
function useResolvedCssLengths(): {
  measurementNodes: JSX.Element;
  read: () => {
    safeAreaTop: number;
    safeAreaRight: number;
    safeAreaBottom: number;
    safeAreaLeft: number;
    dvh100: number;
    svh100: number;
    lvh100: number;
    vh100: number;
  };
} {
  const safeTopRef = useRef<HTMLDivElement>(null);
  const safeRightRef = useRef<HTMLDivElement>(null);
  const safeBottomRef = useRef<HTMLDivElement>(null);
  const safeLeftRef = useRef<HTMLDivElement>(null);
  const dvhRef = useRef<HTMLDivElement>(null);
  const svhRef = useRef<HTMLDivElement>(null);
  const lvhRef = useRef<HTMLDivElement>(null);
  const vhRef = useRef<HTMLDivElement>(null);

  const read = useCallback(() => {
    const computedLength = (node: HTMLDivElement | null, property: "paddingTop" | "paddingRight" | "paddingBottom" | "paddingLeft" | "height"): number => {
      if (!node) return NaN;
      return parseFloat(getComputedStyle(node)[property]);
    };
    return {
      safeAreaTop: computedLength(safeTopRef.current, "paddingTop"),
      safeAreaRight: computedLength(safeRightRef.current, "paddingRight"),
      safeAreaBottom: computedLength(safeBottomRef.current, "paddingBottom"),
      safeAreaLeft: computedLength(safeLeftRef.current, "paddingLeft"),
      dvh100: computedLength(dvhRef.current, "height"),
      svh100: computedLength(svhRef.current, "height"),
      lvh100: computedLength(lvhRef.current, "height"),
      vh100: computedLength(vhRef.current, "height"),
    };
  }, []);

  const measurementNodes = (
    <div aria-hidden="true" style={{ position: "fixed", top: 0, left: 0, width: 0, height: 0, overflow: "hidden", visibility: "hidden" }}>
      <div ref={safeTopRef} style={{ paddingTop: "env(safe-area-inset-top)" }} />
      <div ref={safeRightRef} style={{ paddingRight: "env(safe-area-inset-right)" }} />
      <div ref={safeBottomRef} style={{ paddingBottom: "env(safe-area-inset-bottom)" }} />
      <div ref={safeLeftRef} style={{ paddingLeft: "env(safe-area-inset-left)" }} />
      <div ref={dvhRef} style={{ height: "100dvh" }} />
      <div ref={svhRef} style={{ height: "100svh" }} />
      <div ref={lvhRef} style={{ height: "100lvh" }} />
      <div ref={vhRef} style={{ height: "100vh" }} />
    </div>
  );

  return { measurementNodes, read };
}

export default function DiagnosticoDialogoPage(): React.ReactElement {
  // Portal a `document.body` solo tras hidratar — durante el render en el
  // servidor `document` no existe, y montar el `<dialog>` recién después del
  // primer paint evita el desajuste de hidratación (mismo `null` en server y
  // primer render cliente, el portal real llega en el efecto siguiente).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const bodyRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const { measurementNodes, read: readCssLengths } = useResolvedCssLengths();

  // No-op: esta página no tiene nada detrás del diálogo, así que Escape /
  // click en el backdrop no necesitan desmontar nada. Los botones de cerrar
  // llaman a `dialog.close()` directamente (ver más abajo).
  const onClose = useCallback(() => {}, []);
  const { dialogRef, closeButtonRef, shellStyle } = useNativeDialog(onClose);

  const [lines, setLines] = useState<MeasurementLine[]>([]);
  const [verdictOk, setVerdictOk] = useState<boolean | null>(null);

  useEffect(() => {
    function measure(): void {
      const dialog = dialogRef.current;
      const body = bodyRef.current;
      const footer = footerRef.current;
      if (!dialog || !body || !footer) return;

      const dialogStyle = getComputedStyle(dialog);
      const dialogRect = dialog.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      const viewport = window.visualViewport;
      const cssLengths = readCssLengths();

      const footerVisible = footerRect.bottom <= window.innerHeight + 1;
      const bodyOk = bodyRect.height > 40;
      setVerdictOk(footerVisible && bodyOk);

      const inlineVars =
        shellStyle === undefined
          ? {
              top: "(sin estilo inline)",
              height: "(sin estilo inline)",
              keyboardInset: "(sin estilo inline)",
            }
          : {
              top: String(shellStyle["--dialog-viewport-top" as keyof typeof shellStyle]),
              height: String(shellStyle["--dialog-viewport-height" as keyof typeof shellStyle]),
              keyboardInset: String(shellStyle["--dialog-keyboard-inset" as keyof typeof shellStyle]),
            };

      setLines([
        { label: "window.innerHeight", value: px(window.innerHeight) },
        { label: "document.documentElement.clientHeight", value: px(document.documentElement.clientHeight) },
        { label: "visualViewport.height", value: viewport ? px(viewport.height) : "(sin visualViewport)" },
        { label: "visualViewport.width", value: viewport ? px(viewport.width) : "(sin visualViewport)" },
        { label: "visualViewport.offsetTop", value: viewport ? px(viewport.offsetTop) : "(sin visualViewport)" },
        { label: "visualViewport.pageTop", value: viewport ? px(viewport.pageTop) : "(sin visualViewport)" },
        { label: "visualViewport.scale", value: viewport ? viewport.scale.toFixed(2) : "(sin visualViewport)" },
        { label: "env(safe-area-inset-top)", value: px(cssLengths.safeAreaTop) },
        { label: "env(safe-area-inset-right)", value: px(cssLengths.safeAreaRight) },
        { label: "env(safe-area-inset-bottom)", value: px(cssLengths.safeAreaBottom) },
        { label: "env(safe-area-inset-left)", value: px(cssLengths.safeAreaLeft) },
        { label: "100dvh", value: px(cssLengths.dvh100) },
        { label: "100svh", value: px(cssLengths.svh100) },
        { label: "100lvh", value: px(cssLengths.lvh100) },
        { label: "100vh", value: px(cssLengths.vh100) },
        { label: "dialog computed max-height", value: dialogStyle.maxHeight },
        { label: "dialog computed height", value: dialogStyle.height },
        { label: "dialog computed top", value: dialogStyle.top },
        { label: "dialog computed bottom", value: dialogStyle.bottom },
        { label: "dialog rect.top", value: px(dialogRect.top) },
        { label: "dialog rect.bottom", value: px(dialogRect.bottom) },
        { label: "dialog rect.height", value: px(dialogRect.height) },
        { label: "cuerpo rect.height", value: px(bodyRect.height) },
        { label: "cuerpo scrollHeight", value: px(body.scrollHeight) },
        { label: "pie rect.top", value: px(footerRect.top) },
        { label: "pie rect.bottom", value: px(footerRect.bottom) },
        { label: "PIE VISIBLE", value: footerVisible ? "SI" : "NO" },
        { label: "--dialog-viewport-top (inline)", value: inlineVars.top },
        { label: "--dialog-viewport-height (inline)", value: inlineVars.height },
        { label: "--dialog-keyboard-inset (inline)", value: inlineVars.keyboardInset },
        { label: "navigator.userAgent", value: navigator.userAgent },
      ]);
    }

    measure();
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [dialogRef, readCssLengths, shellStyle]);

  if (!mounted) return <></>;

  return createPortal(
    <>
      {measurementNodes}
      <dialog
        ref={dialogRef}
        aria-modal="true"
        aria-labelledby="diagnostico-dialogo-title"
        className={NATIVE_DIALOG_SHELL_CLASS}
        style={shellStyle}
      >
        {/* Header — shrink-0, igual que en MemberEditDialog/MedicalRecordDialog/PaymentsDialog.
            Título en el mismo paso `title` (20px) que usan esos diálogos: la
            cara Graduate (`font-display`) con su tracking declarado
            (`tracking-flat`) — lo que exige `display-face-usage.test.ts` para
            todo <h1>-<h3> en `text-lg`. */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-sunken px-5 py-4">
          <h2 id="diagnostico-dialogo-title" className="font-display text-lg uppercase tracking-flat text-ink">
            Diagnóstico del diálogo — iOS
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Cerrar diagnóstico"
            className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
          >
            {/* `ICON.base` (18px), nunca un literal — `arbitrary-style-values.test.ts`
                solo acepta un paso de la escala `ICON` en un archivo que importa lucide-react. */}
            <X size={ICON.base} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        {/* Cuerpo scrollable — misma clase compartida que rompe en WebKit real. */}
        <div ref={bodyRef} className={NATIVE_DIALOG_BODY_CLASS}>
          {/* Panel de lectura — mismo par superficie/control que `ModalSection`
              (`rounded-ctl border border-line bg-paper`), `text-ink` (el único
              color que un número de lectura puede llevar, ver el comentario de
              `tailwind.config.ts` sobre `ink`) y `tabular-nums` en `text-base`
              (15px, el piso de la escala tipográfica) para que cada medición
              quede ancha-fija y legible en un pantallazo sin inventar una
              familia monoespaciada que el sistema de diseño no declara. */}
          <div className="mb-4 rounded-ctl border border-ink bg-paper p-3 text-base text-ink">
            <div
              className={`mb-2.5 rounded-ctl px-3 py-2 text-center text-lg font-extrabold ${
                verdictOk === null
                  ? "bg-state-neutral-bg text-state-neutral"
                  : verdictOk
                    ? "bg-state-ok-bg text-state-ok"
                    : "bg-state-bad-bg text-state-bad"
              }`}
            >
              {verdictOk === null ? "MIDIENDO…" : verdictOk ? "DIAGNÓSTICO OK" : "DIAGNÓSTICO ROTO"}
            </div>
            {lines.map((line) => (
              <div key={line.label} className="break-words tabular-nums">
                <strong className="font-semibold">{line.label}:</strong> {line.value}
              </div>
            ))}
          </div>

          {Array.from({ length: FILLER_PARAGRAPH_COUNT }, (_, index) => (
            <p key={index} className="text-sm text-ink-2">
              Párrafo {index + 1} — relleno de altura para forzar scroll interno en el cuerpo, igual que el
              cuerpo real de Editar miembro (scrollHeight ≈1132px). Este texto no mide nada por sí mismo; solo
              existe para que el cuerpo tenga contenido de sobra y el scroll sea obligatorio.
            </p>
          ))}
        </div>

        {/* Pie — shrink-0, igual que en los diálogos reales. */}
        <div ref={footerRef} className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3.5">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-lg border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink hover:bg-sunken"
          >
            Cerrar
          </button>
        </div>
      </dialog>
    </>,
    document.body,
  );
}
