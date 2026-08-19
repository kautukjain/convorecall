import { describe, expect, it } from "vitest";
import { HealthController } from "./health.controller.js";

describe("HealthController", () => {
  it("reports liveness in the documented shape", () => {
    const body = new HealthController().check();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("convorecall-api");
    expect(typeof body.version).toBe("string");
  });
});
