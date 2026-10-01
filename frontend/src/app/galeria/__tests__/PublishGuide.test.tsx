import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PublishGuide from "../PublishGuide";
import { MAX_IMAGE_BYTES } from "../uploadError";

describe("PublishGuide", () => {
  it("renders the rules with the file limit derived from the validation constant", () => {
    render(<PublishGuide title="Cómo se publica" rules={[
      { term: "Dónde aparece", detail: "En la landing." },
      { term: "Al eliminar", detail: "Deja de mostrarse." },
    ]} />);
    expect(screen.getByRole("heading", { name: "Cómo se publica" })).toBeInTheDocument();
    expect(screen.getByText(`JPG o PNG, hasta ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`)).toBeInTheDocument();
    const terms = screen.getAllByRole("term").map((node) => node.textContent);
    expect(terms).toEqual(["Dónde aparece", "Formato y tamaño", "Al eliminar"]);
  });
});
