/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ReadOnlyReasonNotice from "../ReadOnlyReasonNotice";

describe("ReadOnlyReasonNotice", () => {
  it("says «aquí», not the rioplatense «acá» (ENT-15)", () => {
    render(<ReadOnlyReasonNotice />);

    expect(screen.getByText(/no se puede editar desde aquí/)).toBeInTheDocument();
    expect(screen.queryByText(/acá/i)).not.toBeInTheDocument();
  });
});
