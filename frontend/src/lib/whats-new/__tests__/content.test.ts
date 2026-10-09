import { describe, it, expect } from "vitest";
import {
  WHATS_NEW_HEADER,
  WHATS_NEW_ITEMS,
  splitLead,
  whatsNewAudienceFor,
} from "../content";

describe("whatsNewAudienceFor", () => {
  it("maps each role to its list", () => {
    expect(whatsNewAudienceFor(["admin"])).toBe("admin");
    expect(whatsNewAudienceFor(["trainer"])).toBe("entrenador");
    expect(whatsNewAudienceFor(["estudiante"])).toBe("alumno");
    expect(whatsNewAudienceFor(["representante"])).toBe("alumno");
  });

  it("gives several roles the highest-priority list", () => {
    expect(whatsNewAudienceFor(["estudiante", "trainer", "admin"])).toBe("admin");
    expect(whatsNewAudienceFor(["representante", "trainer"])).toBe("entrenador");
    expect(whatsNewAudienceFor(["estudiante", "representante"])).toBe("alumno");
  });

  it("returns null for an unknown or empty role set", () => {
    expect(whatsNewAudienceFor(["unsupported"])).toBeNull();
    expect(whatsNewAudienceFor([])).toBeNull();
  });
});

describe("approved copy (verbatim)", () => {
  it("keeps the header", () => {
    expect(WHATS_NEW_HEADER.title).toBe("CataClub se renovó");
    expect(WHATS_NEW_HEADER.intro).toBe(
      "Le dimos una nueva imagen al sistema para que sea más claro y cómodo de usar, sobre todo desde el celular. Ahora las ventanas y los avisos aparecen con más suavidad.",
    );
  });

  it("keeps the admin list", () => {
    expect(WHATS_NEW_ITEMS.admin).toEqual([
      "Modo oscuro: actívalo desde tu menú de cuenta, también en el inicio de sesión.",
      "Miembros más claros: la membresía y el representante aparecen solo en quienes juegan.",
      "Pagos más fáciles de revisar: los nombres se leen completos y las bonificaciones se muestran de a 10.",
      "Carnets renovados: elegir e imprimir carnets ahora es más simple.",
      "¿Algo no anda? El botón para reportar un problema está siempre arriba, en la barra.",
    ]);
  });

  it("keeps the entrenador list", () => {
    expect(WHATS_NEW_ITEMS.entrenador).toEqual([
      "Modo oscuro: actívalo desde tu menú de cuenta.",
      "Tu lista y tus grupos, más livianos: filas más compactas y fáciles de leer.",
      "Mejor en el celular: botones más grandes y más fáciles de tocar.",
      "¿Algo no anda? El botón para reportar un problema está siempre arriba, en la barra.",
    ]);
  });

  it("keeps the estudiante/representante list", () => {
    expect(WHATS_NEW_ITEMS.alumno).toEqual([
      "Modo oscuro: actívalo desde tu menú de cuenta.",
      "Tu panel, de un vistazo: tu membresía y tus números importantes se ven claros apenas entras.",
      "Pagos más claros: el estado de cada pago se entiende sin tener que abrirlo.",
      "Mejor en el celular: botones más grandes y pantallas más ordenadas.",
    ]);
  });
});

describe("splitLead", () => {
  it("bolds the text before the first colon", () => {
    expect(splitLead("Modo oscuro: actívalo desde tu menú de cuenta.")).toEqual({
      lead: "Modo oscuro:",
      rest: " actívalo desde tu menú de cuenta.",
    });
  });

  it("leaves a bullet without a colon unbolded", () => {
    const text = WHATS_NEW_ITEMS.admin[4];
    expect(splitLead(text)).toEqual({ lead: null, rest: text });
  });
});
