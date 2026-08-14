import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { FixtureSttProvider } from "./fixture-stt.provider.js";

// The provider resolves fixtures relative to the API working directory.
beforeAll(() => {
  process.chdir(resolve(import.meta.dirname, "../../../.."));
});

describe("FixtureSttProvider", () => {
  it("loads the hand-authored objection call", async () => {
    const result = await new FixtureSttProvider().load("objection-call");

    expect(result.segments).toHaveLength(43);
    expect(result.segments[13]?.text).toBe(
      "We're not sure we can justify that pricing right now.",
    );
    expect(result.segments[13]?.speaker).toBe("Prospect");
    expect(result.durationMs).toBe(217_420);
    // Null model records that no STT ran — it is not a missing value.
    expect(result.model).toBeNull();
  });

  it("rejects a traversal attempt in the fixture name", async () => {
    const provider = new FixtureSttProvider();
    await expect(provider.load("../../../etc/passwd")).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(provider.load("..%2Fsecrets")).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("reports a missing fixture as an invalid request", async () => {
    await expect(
      new FixtureSttProvider().load("no-such-call"),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
});
