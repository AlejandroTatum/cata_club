import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useBodyScrollLock } from "../useBodyScrollLock";

describe("useBodyScrollLock", (): void => {
  it("hides body overflow while locked and restores it on unlock", (): void => {
    document.body.style.overflow = "auto";
    const { rerender } = renderHook(({ locked }) => useBodyScrollLock(locked), {
      initialProps: { locked: true },
    });
    expect(document.body.style.overflow).toBe("hidden");
    rerender({ locked: false });
    expect(document.body.style.overflow).toBe("auto");
  });

  it("keeps the lock until the last stacked consumer unmounts", (): void => {
    document.body.style.overflow = "";
    const first = renderHook(() => useBodyScrollLock(true));
    const second = renderHook(() => useBodyScrollLock(true));
    first.unmount();
    expect(document.body.style.overflow).toBe("hidden");
    second.unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
