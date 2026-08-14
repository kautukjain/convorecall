import { describe, expect, it, vi } from "vitest";
import { ProblemException } from "../../common/problem.js";
import { CallsService, type UploadedAudio } from "./calls.service.js";
import type { CallsRepository, CallWithJob } from "./calls.repository.js";
import type { StorageService } from "./storage.service.js";
import type { UrlFetchService } from "./url-fetch.service.js";

const MP3 = Buffer.concat([
  Buffer.from("ID3", "ascii"),
  Buffer.alloc(64),
]);

function makeService(overrides?: {
  createWithJob?: ReturnType<typeof vi.fn>;
  findById?: ReturnType<typeof vi.fn>;
  put?: ReturnType<typeof vi.fn>;
}) {
  const createWithJob =
    overrides?.createWithJob ??
    vi.fn(async (input: Record<string, unknown>) => ({
      id: "11111111-1111-4111-8111-111111111111",
      createdAt: new Date("2026-08-10T09:00:00Z"),
      ...input,
      job: { state: "QUEUED" },
    }) as unknown as CallWithJob);

  const put = overrides?.put ?? vi.fn(async () => ({
    storageKey: "22222222-2222-4222-8222-222222222222.mp3",
    sizeBytes: MP3.byteLength,
  }));

  const repository = {
    createWithJob,
    findById: overrides?.findById ?? vi.fn(async () => null),
  } as unknown as CallsRepository;

  const storage = { put } as unknown as StorageService;

  // URL validation is exercised in url-fetch.service.spec.ts; here it must simply pass.
  const urls = {
    assertFetchable: vi.fn(async () => undefined),
  } as unknown as UrlFetchService;

  const config = {
    get: (key: string) =>
      ({
        UPLOAD_MAX_BYTES: 1_000_000,
        JOB_DEADLINE_MS: 900_000,
        JOB_TOKEN_BUDGET: 120_000,
      })[key],
  };

  return {
    service: new CallsService(repository, storage, urls, config as never),
    createWithJob,
    put,
  };
}

const upload = (buffer: Buffer, name = "call.mp3"): UploadedAudio => ({
  buffer,
  originalname: name,
  size: buffer.byteLength,
});

describe("CallsService.createFromUpload", () => {
  it("stores a valid mp3 and creates the call with its job", async () => {
    const { service, createWithJob, put } = makeService();
    await service.createFromUpload(upload(MP3));

    expect(put).toHaveBeenCalledOnce();
    const input = createWithJob.mock.calls[0]?.[0];
    expect(input.source).toBe("UPLOAD");
    expect(input.mimeType).toBe("audio/mpeg");
    // The original name is retained for display but never used as the storage key.
    expect(input.originalName).toBe("call.mp3");
    expect(input.storageKey).not.toContain("call.mp3");
    expect(input.deadlineAt).toBeInstanceOf(Date);
    expect(input.tokenBudget).toBe(120_000);
  });

  it("rejects a non-audio file whatever it is named, and stores nothing", async () => {
    const { service, put, createWithJob } = makeService();
    const png = Buffer.concat([
      Buffer.from([0x89]),
      Buffer.from("PNG\r\n\n", "ascii"),
      Buffer.alloc(32),
    ]);

    await expect(service.createFromUpload(upload(png, "totally.mp3"))).rejects.toThrow(
      ProblemException,
    );
    expect(put).not.toHaveBeenCalled();
    expect(createWithJob).not.toHaveBeenCalled();
  });

  it("rejects an oversized file before touching storage", async () => {
    const { service, put } = makeService();
    const big = { ...upload(MP3), size: 2_000_000 };

    await expect(service.createFromUpload(big)).rejects.toMatchObject({
      code: "upload_too_large",
    });
    expect(put).not.toHaveBeenCalled();
  });
});

describe("CallsService.createFromBody", () => {
  it("accepts a url ingest", async () => {
    const { service, createWithJob } = makeService();
    await service.createFromBody({ url: "https://example.com/call.mp3" });
    expect(createWithJob.mock.calls[0]?.[0].source).toBe("URL");
  });

  it("rejects an unknown fixture name", async () => {
    const { service } = makeService();
    await expect(
      service.createFromBody({ fixture: "no-such-call" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("rejects an empty body", async () => {
    const { service } = makeService();
    await expect(service.createFromBody({})).rejects.toMatchObject({
      code: "invalid_request",
    });
  });
});

describe("CallsService.findById", () => {
  it("raises call_not_found rather than returning null", async () => {
    const { service } = makeService({ findById: vi.fn(async () => null) });
    await expect(service.findById("missing")).rejects.toMatchObject({
      code: "call_not_found",
    });
  });
});
