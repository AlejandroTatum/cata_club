/**
 * ConnectivityBanner — issue #454.
 *
 * `useAuth()` is mocked directly here (unlike the AuthContext-level tests,
 * this component has exactly one job: render — or not — off
 * `periodicOutage`), so these tests are about the RENDERING contract, not
 * the detection state machine covered in `AuthContextConnectivity.test.tsx`.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const mockUseAuth = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

import ConnectivityBanner from "@/components/ConnectivityBanner";

describe("ConnectivityBanner", () => {
  it("renders nothing while the connection is healthy", () => {
    mockUseAuth.mockReturnValue({ periodicOutage: false });
    const { container } = render(<ConnectivityBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the persistent outage message when periodicOutage is true", () => {
    mockUseAuth.mockReturnValue({ periodicOutage: true });
    render(<ConnectivityBanner />);

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Sin conexión con el servidor — reintentando…");
  });

  // TRIANGULATE: one shared boolean can only ever produce one element —
  // there is no per-request counter here to double up the way concurrent
  // failing fetches could duplicate a page-local toast.
  it("never renders more than one banner instance, however many times outage is confirmed", () => {
    mockUseAuth.mockReturnValue({ periodicOutage: true });
    const { rerender } = render(<ConnectivityBanner />);
    rerender(<ConnectivityBanner />);
    rerender(<ConnectivityBanner />);

    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  // TRIANGULATE: a healthy backend with one endpoint returning an error is
  // NOT a periodicOutage — that path stays local (the page's own
  // ErrorState/toast, untouched by this change) and must not raise this
  // banner. This component has no way to reach that state wrongly since it
  // only ever reads the one flag, but the assertion pins the contract.
  it("stays hidden for a value other than an explicit outage flag", () => {
    mockUseAuth.mockReturnValue({ periodicOutage: false });
    render(<ConnectivityBanner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
