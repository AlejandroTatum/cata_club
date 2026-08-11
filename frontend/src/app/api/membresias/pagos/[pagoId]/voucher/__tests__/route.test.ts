/** @vitest-environment node */

/**
 * PAG-3: a padre uploading the wrong file type used to see only "No se pudo
 * subir el comprobante." — a generic toast — even though this route already
 * writes a specific, hand-authored Spanish sentence explaining exactly what
 * went wrong. The sentence never reached the screen because it echoed the
 * rejected file's raw MIME type (`file.type`, e.g. `text/plain`) verbatim,
 * and `isUserFacingText`'s vocabulary gate exists specifically to catch a raw
 * MIME type in a `detail` — see `lib/error-message.ts`'s `IMPLEMENTATION_VOCABULARY`
 * and its test "still catches a real MIME type". That gate is correct and
 * stays as-is: a leaked `image/heic` from the backend must keep failing it.
 * The fix belongs here, not there — this message is the frontend's own copy,
 * so it should never have needed to name the MIME type to be useful.
 */

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST } from "../route";
import { isUserFacingText } from "@/lib/error-message";

function requestWithFile(file: File): NextRequest {
  const formData = new FormData();
  formData.append("archivo", file);
  return new NextRequest("http://localhost/api/membresias/pagos/1/voucher", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/membresias/pagos/[pagoId]/voucher — rejected file type", () => {
  it("explains the problem in a sentence that passes the user-facing text gate", async () => {
    const file = new File(["contenido"], "nota.txt", { type: "text/plain" });
    const response = await POST(requestWithFile(file), { params: { pagoId: "1" } });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { message: string };

    // The message must not name the raw MIME type it used to echo.
    expect(body.message).not.toMatch(/text\/plain/);
    // And it must survive the same gate the client runs every error through
    // before showing it — this is the assertion that would have caught PAG-3.
    expect(isUserFacingText(body.message)).toBe(true);
  });
});
