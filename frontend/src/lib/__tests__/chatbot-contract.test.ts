/**
 * The canonical-glossary snapshot's contract, frontend side (issue #903).
 *
 * `cata_club-docs` owns the product glossary; the app ships a pinned,
 * generated snapshot of it inside `src/data/club-knowledge.json` (mirrored
 * byte for byte from `backend/.../conocimiento_club.json`). This file is the
 * frontend half of the shared divergence gate: it recomputes the snapshot's
 * content hash with `node:crypto` — the same stable serialization the root
 * gate hashes in Python — and checks that the copy the frontend actually
 * ships uses the canonical terms. Everything reads files already in the repo:
 * no network, no clone of the docs repo.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import knowledge from "@/data/club-knowledge.json";
import quickReplies from "@/data/club-quick-replies.json";

interface GlossaryEntry {
  id: string;
  canonical_term: string;
  definition: string;
  prohibited_variants: string[];
  deprecated_variants: string[];
  technical_forms: string[];
  context_forms?: string[];
  notes?: string[];
  sources: string[];
}

const { glosario: snapshot, ...helpData } = knowledge;
const entries = snapshot.entradas as GlossaryEntry[];

/**
 * The stable serialization both gates hash: keys sorted, no insignificant
 * whitespace — `json.dumps(entries, sort_keys=True, ensure_ascii=False,
 * separators=(",", ":"))` on the Python side, this on the Node side.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** The shipped help copy as the gate scans it: the knowledge payload minus the
 * pinned glosario snapshot, whose own prohibited-variant metadata must not trip
 * the copy sweep. */
const helpText = JSON.stringify(helpData);
const quickReplyText = JSON.stringify(quickReplies);

/** Representative uses: [entry id, fragment that must appear in the copy]. */
const HELP_USES: Array<[string, string]> = [
  ["membresia", "Membresías y Pagos"],
  ["tipo_membresia", "valor de cada plan"],
  ["jugador", "selector de estudiante"],
];
const QUICK_REPLY_USES: Array<[string, string]> = [["asistencia", "¿Dónde veo la asistencia?"]];

describe("the pinned glossary snapshot", () => {
  it("declares its authority, source commit and published hash", () => {
    expect(snapshot.autoridad).toBe("AlejandroTatum/cata_club-docs");
    expect(snapshot.archivo_fuente).toBe("reference/glosario.json");
    expect(snapshot.commit_fuente).toMatch(/^[0-9a-f]{40}$/);
    expect(snapshot.sha256_fuente_publicada).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.idioma).toBe("es-EC");
  });

  it("is marked generated and not hand-editable", () => {
    expect(snapshot.generado).toBe(true);
    expect(snapshot.no_editar_a_mano).toBe(true);
  });

  it("carries a content hash that recomputes from its entries", () => {
    expect(sha256(stableStringify(entries))).toBe(snapshot.entradas_sha256);
  });

  it("is not empty and its ids are unique", () => {
    expect(entries.length).toBeGreaterThan(0);
    const ids = entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of entries) {
      expect(entry.canonical_term.trim()).not.toBe("");
      expect(entry.definition.trim()).not.toBe("");
    }
  });
});

describe("the shared gate, frontend side", () => {
  it("uses canonical terms in the help copy it ships", () => {
    const known = new Set(entries.map((entry) => entry.id));
    for (const [term, fragment] of HELP_USES) {
      expect(known.has(term), `unknown glossary entry: ${term}`).toBe(true);
      expect(helpText, `${term} missing from the help copy`).toContain(fragment);
    }
  });

  it("uses canonical terms in the chat quick replies", () => {
    const known = new Set(entries.map((entry) => entry.id));
    for (const [term, fragment] of QUICK_REPLY_USES) {
      expect(known.has(term), `unknown glossary entry: ${term}`).toBe(true);
      expect(quickReplyText, `${term} missing from the quick replies`).toContain(fragment);
    }
  });

  it("keeps prohibited variants out of the shipped help data", () => {
    const prohibited = entries.flatMap((entry) => entry.prohibited_variants ?? []);
    expect(prohibited.length).toBeGreaterThan(0);
    const shipped = `${helpText}\n${quickReplyText}`.toLowerCase();
    for (const variant of prohibited) {
      expect(shipped, `prohibited variant shipped: ${variant}`).not.toContain(variant.toLowerCase());
    }
  });
});

describe("the gate refuses hollow inputs", () => {
  it("fails when the glossary is emptied", () => {
    // The live guard: an emptied snapshot breaks this suite on the first line,
    // and its hash no longer matches the one pinned in the snapshot.
    expect(entries.length, "glossary snapshot is empty").toBeGreaterThan(0);
    expect(sha256(stableStringify([]))).not.toBe(snapshot.entradas_sha256);
  });

  it("no longer recomputes once an entry is hand-edited", () => {
    const tampered = structuredClone(entries);
    tampered[0].canonical_term += " (hand-edited)";
    expect(sha256(stableStringify(tampered))).not.toBe(snapshot.entradas_sha256);
  });
});
