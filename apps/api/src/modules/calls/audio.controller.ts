import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Controller, Get, Logger, Param, Res } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { ProblemException } from "../../common/problem.js";
import { CallsRepository } from "./calls.repository.js";
import { CallIdParamSchema } from "./dto/create-call.dto.js";
import { StorageService } from "./storage.service.js";

/**
 * Serves the recording behind a call, so the notes page can play the moment a claim came from.
 *
 * Two sources, because a call arrives two ways (ADR-012). An upload or a fetched URL is in
 * object storage under its `storageKey`. A fixture call has no stored object at all — its audio
 * is the checked-in sample in `sample-data/audio/`, addressed by fixture name.
 *
 * Delegates to `res.sendFile`, which answers `Range` requests. That is not a detail: without
 * range support a browser must download the whole file before it can seek, so clicking a claim
 * at 2:22 would stall instead of jumping.
 */
@ApiTags("calls")
@Controller("calls")
export class AudioController {
  private readonly logger = new Logger(AudioController.name);
  private readonly sampleAudio = resolve(process.cwd(), "../../sample-data/audio");

  constructor(
    private readonly calls: CallsRepository,
    private readonly storage: StorageService,
  ) {}

  @ApiOperation({ summary: "Stream the call recording, with range support for seeking" })
  @ApiResponse({ status: 206, description: "Partial content for a ranged request." })
  @ApiResponse({ status: 404, description: "audio_not_available" })
  @Get(":id/audio")
  async audio(@Param("id") id: string, @Res() res: Response): Promise<void> {
    const parsed = CallIdParamSchema.safeParse(id);
    if (!parsed.success) {
      throw new ProblemException("call_not_found", "No call with that id.");
    }

    const call = await this.calls.findById(parsed.data);
    if (!call) {
      throw new ProblemException("call_not_found", "No call with that id.");
    }

    const path = this.locate(call);
    if (!path || !existsSync(path)) {
      // A transcript can outlive its audio — a cleaned-up upload, or a fixture with no
      // recording checked in. That is an ordinary state, not a failure of the call.
      throw new ProblemException(
        "audio_not_available",
        "No recording is available for this call.",
        path ? `Expected audio at ${path}` : "Call has neither a stored object nor a fixture",
      );
    }

    // Revalidate rather than trust an age. `sendFile` sets ETag and Last-Modified, so an
    // unchanged file still costs only a 304 — while a regenerated sample recording is picked
    // up immediately instead of a stale copy playing for an hour. Private, because the URL is
    // unauthenticated and a shared cache must not hand one customer's call to another.
    res.setHeader("cache-control", "private, no-cache");

    // `dotfiles: "allow"` is load-bearing, not cosmetic. Uploads are stored under
    // `.data/uploads`, and `send` defaults to `dotfiles: "ignore"`, which reports any path with a
    // dot-prefixed component as missing — so a stored recording sitting on disk 404s here while
    // fixture audio in `sample-data/` serves fine. The path is built from a generated storage key,
    // never from caller input, and its existence is checked above.
    res.sendFile(path, { dotfiles: "allow" }, (error) => {
      // `sendFile` reports failures asynchronously. Without this callback the error escapes the
      // request scope and surfaces as a bare 500 with no indication of which file failed.
      if (error) {
        this.logger.error(
          `Failed to stream audio for call ${call.id}: ${
            error instanceof Error ? error.message : String(error)
          } (${path})`,
        );
      }
    });
  }

  /** Stored object first; otherwise the sample recording for a fixture call. */
  private locate(call: { storageKey: string | null; sourceRef: string | null }): string | null {
    if (call.storageKey) {
      // `pathFor` throws on a malformed key. A bad database row is a missing recording as far as a
      // reader is concerned, so it becomes an honest 404 rather than escaping as a 500.
      try {
        return this.storage.pathFor(call.storageKey);
      } catch {
        return null;
      }
    }
    if (!call.sourceRef || !/^[a-z0-9-]{1,64}$/.test(call.sourceRef)) return null;

    const path = resolve(this.sampleAudio, `${call.sourceRef}.mp3`);
    // The name is already constrained above; this is the second lock on path traversal.
    return path.startsWith(this.sampleAudio) ? path : null;
  }
}
