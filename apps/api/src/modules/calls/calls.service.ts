import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ProblemException } from "../../common/problem.js";
import { detectAudioType } from "./audio-signature.js";
import { CallsRepository, type CallWithJob } from "./calls.repository.js";
import type { CreateCallBody } from "./dto/create-call.dto.js";
import { StorageService } from "./storage.service.js";
import { UrlFetchService } from "./url-fetch.service.js";

const EXTENSION_BY_TYPE: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "mp4",
  "audio/m4a": "m4a",
  "audio/webm": "webm",
};

export type UploadedAudio = {
  buffer: Buffer;
  originalname: string;
  size: number;
};

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private readonly repository: CallsRepository,
    private readonly storage: StorageService,
    private readonly urls: UrlFetchService,
    private readonly config: ConfigService,
  ) {}

  async createFromUpload(file: UploadedAudio): Promise<CallWithJob> {
    const maxBytes = this.config.get<number>("UPLOAD_MAX_BYTES") ?? 104_857_600;
    if (file.size > maxBytes) {
      throw new ProblemException(
        "upload_too_large",
        `File exceeds the ${Math.floor(maxBytes / 1_048_576)} MB limit.`,
      );
    }

    // Sniff the bytes. The declared Content-Type and the filename are not evidence.
    const detected = detectAudioType(file.buffer);
    if (!detected) {
      throw new ProblemException(
        "unsupported_media_type",
        "File is not a supported audio format (mp3, wav, m4a, mp4, webm).",
        `rejected upload named ${file.originalname}`,
      );
    }

    const stored = await this.storage.put(
      file.buffer,
      EXTENSION_BY_TYPE[detected] ?? "bin",
    );

    return this.create({
      source: "UPLOAD",
      storageKey: stored.storageKey,
      originalName: file.originalname,
      mimeType: detected,
      sizeBytes: stored.sizeBytes,
    });
  }

  async createFromBody(body: CreateCallBody): Promise<CallWithJob> {
    if (body.fixture) {
      const path = resolve(
        process.cwd(),
        "../../sample-data/transcripts",
        `${body.fixture}.json`,
      );
      if (!existsSync(path)) {
        throw new ProblemException(
          "invalid_request",
          `No fixture named "${body.fixture}".`,
        );
      }
      // Fixture mode skips ingest and STT entirely (ADR-012).
      return this.create({ source: "FIXTURE", sourceRef: body.fixture });
    }

    if (body.url) {
      // Shape is checked here so an obviously bad link fails at POST time; the actual
      // download happens in the worker, because it can take as long as an upload.
      await this.urls.assertFetchable(body.url);
      return this.create({ source: "URL", sourceRef: body.url });
    }

    throw new ProblemException(
      "invalid_request",
      "Provide a file upload, a url, or a fixture name.",
    );
  }

  async findById(id: string): Promise<CallWithJob> {
    const call = await this.repository.findById(id);
    if (!call) {
      throw new ProblemException("call_not_found", "No call with that id.");
    }
    return call;
  }

  private async create(input: {
    source: "UPLOAD" | "URL" | "FIXTURE";
    sourceRef?: string;
    storageKey?: string;
    originalName?: string;
    mimeType?: string;
    sizeBytes?: number;
  }): Promise<CallWithJob> {
    const deadlineMs = this.config.get<number>("JOB_DEADLINE_MS") ?? 900_000;
    const tokenBudget = this.config.get<number>("JOB_TOKEN_BUDGET") ?? 120_000;

    const call = await this.repository.createWithJob({
      ...input,
      deadlineAt: new Date(Date.now() + deadlineMs),
      tokenBudget,
    });

    this.logger.log(`Queued call ${call.id} from ${input.source.toLowerCase()}`);
    return call;
  }
}
