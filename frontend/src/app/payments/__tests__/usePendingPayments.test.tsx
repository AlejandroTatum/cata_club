/**
 * The sidebar's pending-payments badge refreshes on demand (ADMA-28): another
 * admin resolving a payment must not leave the badge on a stale figure.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  PENDING_PAYMENTS_REFRESH_EVENT,
  refreshPendingPaymentsCount,
  usePendingPaymentsCount,
} from "@/lib/usePendingPayments";

const mockFetchDashboardStats = vi.fn();

vi.mock("@/services/api", () => ({
  fetchDashboardStats: () => mockFetchDashboardStats(),
}));

beforeEach(() => {
  mockFetchDashboardStats.mockReset();
});

describe("usePendingPaymentsCount", () => {
  it("re-reads the count when a refresh is requested", async () => {
    mockFetchDashboardStats
      .mockResolvedValueOnce({ pendingPayments: 38 })
      .mockResolvedValueOnce({ pendingPayments: 37 });
    const { result } = renderHook(() => usePendingPaymentsCount(true));
    await waitFor(() => expect(result.current).toBe(38));

    act(() => refreshPendingPaymentsCount());

    await waitFor(() => expect(result.current).toBe(37));
  });

  it("ignores a refresh request while disabled", async () => {
    renderHook(() => usePendingPaymentsCount(false));

    act(() => {
      window.dispatchEvent(new Event(PENDING_PAYMENTS_REFRESH_EVENT));
    });

    expect(mockFetchDashboardStats).not.toHaveBeenCalled();
  });
});
