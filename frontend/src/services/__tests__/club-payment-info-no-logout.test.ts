/**
 * «Cómo pagar» is an optional block: a 401 from its route must reach the caller
 * as an error and must NOT run refresh-and-retry or the app-wide auth failure
 * (which clears the session and bounces the user to /login).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchClubPaymentInfo, subscribeAuthFailure } from "../api";

describe("fetchClubPaymentInfo", () => {
  afterEach(() => vi.restoreAllMocks());

  it("surfaces a 401 locally without refreshing or notifying auth failure", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    const onFailure = vi.fn();
    const unsubscribe = subscribeAuthFailure(onFailure);

    await expect(fetchClubPaymentInfo()).rejects.toMatchObject({ status: 401 });

    unsubscribe();
    expect(onFailure).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/club/payment-info");
  });

  it("returns the parsed info on 200", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ holder: "X" }), { status: 200 }));
    await expect(fetchClubPaymentInfo()).resolves.toEqual({ holder: "X" });
  });
});
