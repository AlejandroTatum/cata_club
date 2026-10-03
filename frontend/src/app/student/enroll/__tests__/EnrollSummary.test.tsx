import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EnrollSummary from "../EnrollSummary";
import { initialFormData, type EnrollFormData } from "../enroll-utils";

function birthDateYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setDate(d.getDate() - 2);
  return d.toISOString().slice(0, 10);
}

function renderSummary(years: number) {
  const formData: EnrollFormData = {
    ...initialFormData,
    fechaNacimiento: birthDateYearsAgo(years),
  };
  render(<EnrollSummary formData={formData} steps={["personal"] as never} currentStep={"personal" as never} />);
}

describe("EnrollSummary age", () => {
  it("writes one year in the singular", () => {
    renderSummary(1);
    expect(screen.getByText(/^1 año$/)).toBeInTheDocument();
    expect(screen.queryByText(/1 años/)).not.toBeInTheDocument();
  });

  it("keeps the plural for any other age", () => {
    renderSummary(30);
    expect(screen.getByText("30 años")).toBeInTheDocument();
  });
});

// REG-19: a long value wraps inside the rail instead of being cut off with an
// ellipsis the visitor cannot expand.
describe("EnrollSummary values", () => {
  it("lets a long fact wrap instead of truncating it", () => {
    const formData: EnrollFormData = { ...initialFormData, correo: "una.direccion.muy.larga@ejemplo.com.ec" };
    render(<EnrollSummary formData={formData} steps={["personal"] as never} currentStep={"personal" as never} />);

    const value = screen.getByText("una.direccion.muy.larga@ejemplo.com.ec");
    expect(value.className).not.toContain("truncate");
    expect(value.className).toContain("break-words");
  });
});
