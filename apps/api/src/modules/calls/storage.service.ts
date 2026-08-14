import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export type StoredObject = {
  /** Opaque key. Never a path, never derived from the uploaded filename. */
  storageKey: string;
  sizeBytes: number;
};

/**
 * Local-disk storage for Phase 1. Object storage is a later swap behind this interface.
 *
 * Two rules from .cursor/rules/security.mdc are enforced here rather than trusted:
 * filenames are generated, and nothing derived from user input reaches a path.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly root: string;

  constructor(config: ConfigService) {
    const configured = config.get<string>("STORAGE_DIR") ?? ".data/uploads";
    this.root = isAbsolute(configured)
      ? configured
      : resolve(process.cwd(), configured);
  }

  async put(contents: Buffer, extension: string): Promise<StoredObject> {
    // The key is generated. The original filename is retained separately for display
    // only, so a crafted name like `../../etc/passwd` can never influence a path.
    const safeExtension = /^[a-z0-9]{1,8}$/.test(extension) ? extension : "bin";
    const storageKey = `${randomUUID()}.${safeExtension}`;

    await mkdir(this.root, { recursive: true });
    const destination = join(this.root, storageKey);

    // Defence in depth: the key is generated, but assert containment anyway.
    if (!resolve(destination).startsWith(resolve(this.root))) {
      throw new Error("Refusing to write outside the storage root");
    }

    await writeFile(destination, contents, { flag: "wx" });
    this.logger.log(`Stored ${contents.byteLength} bytes as ${storageKey}`);

    return { storageKey, sizeBytes: contents.byteLength };
  }

  /** Resolves a storage key to a path. Rejects anything that is not a bare key. */
  pathFor(storageKey: string): string {
    if (!/^[a-f0-9-]{36}\.[a-z0-9]{1,8}$/.test(storageKey)) {
      throw new Error("Invalid storage key");
    }
    return join(this.root, storageKey);
  }
}
