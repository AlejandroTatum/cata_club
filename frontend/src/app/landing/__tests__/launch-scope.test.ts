import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("launch curtain scope", () => {
  it("is mounted only by the landing home", () => {
    expect(read("src/app/page.tsx")).toContain("<LaunchCurtain");
    expect(read("src/app/login/page.tsx")).not.toMatch(/LaunchCurtain|launch-curtain/);
    expect(read("src/app/layout.tsx")).not.toMatch(/LaunchCurtain|launch-curtain/);
  });
});
