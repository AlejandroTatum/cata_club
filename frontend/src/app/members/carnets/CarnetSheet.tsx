/**
 * The batch print layout: N carnets, nine to an A4 sheet, each on a 85,6×54mm
 * cell with crop marks (geometry in `globals.css`, `.carnet-sheet`).
 *
 * Every card is `MemberCardCredential` — the one the player sees — so the
 * batch cannot drift from the single carnet. Only `#carnet-batch` prints; the
 * controls around it live outside.
 */

"use client";

import { MemberCardCredential } from "@/app/student/MemberCard";
import type { CarnetSummary } from "@/services/api";
import { chunkIntoSheets } from "./carnet-sheet-utils";

/**
 * A4 with a 10mm margin, only while a batch is on screen: the page rule is
 * emitted by this component, so it leaves with it and the single carnet keeps
 * its `size: auto` sheet (`globals.css`). It comes later in the document than
 * that stylesheet, so it wins. A named page (`@page carnets` + `page:`) was
 * tried first and Chromium ignored it on the absolutely positioned sheet.
 */
export const A4_PRINT_PAGE_CSS = "@media print { @page { size: A4; margin: 10mm; } }";

export default function CarnetSheet({ carnets }: { carnets: readonly CarnetSummary[] }): React.ReactElement {
  const sheets = chunkIntoSheets(carnets);
  return (
    <div id="carnet-batch" data-testid="carnet-batch" className="overflow-x-auto">
      <style>{A4_PRINT_PAGE_CSS}</style>
      {sheets.map((sheet, index) => (
        <section
          key={sheet[0].profile.personaId}
          data-testid="carnet-sheet"
          aria-label={`Hoja ${index + 1} de ${sheets.length}`}
          className="carnet-sheet mb-section print:mb-0"
        >
          {sheet.map((carnet) => (
            <div key={carnet.profile.personaId} className="carnet-sheet-cell">
              <div className="carnet-sheet-clip">
                <div className="carnet-sheet-scale">
                  <MemberCardCredential
                    variant="sheet"
                    profile={carnet.profile}
                    coverageEnd={carnet.coverageEnd}
                    horariosState={{ status: "ready", asignaciones: carnet.asignaciones }}
                  />
                </div>
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
