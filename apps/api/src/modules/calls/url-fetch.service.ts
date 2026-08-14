import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ProblemException } from "../../common/problem.js";

/** Enough for a normal CDN hop chain; more suggests a loop. */
const MAX_REDIRECTS = 5;

export type FetchedAudio = {
  buffer: Buffer;
  declaredType: string | null;
  fileName: string;
};

/**
 * Fetches audio from a user-supplied URL.
 *
 * This is a server-side request built from untrusted input, which makes it an SSRF
 * surface: without checks it would happily fetch `http://localhost:5433`,
 * `http://169.254.169.254/` (cloud metadata), or anything else reachable from the API
 * host but not from the caller. Every hop is resolved and checked against private ranges
 * before a request is made, and redirects are followed by hand with every hop
 * revalidated — a permitted host must not be able to redirect us to a forbidden one.
 */
@Injectable()
export class UrlFetchService {
  private readonly logger = new Logger(UrlFetchService.name);

  constructor(private readonly config: ConfigService) {}

  /** Rejects loopback, link-local, private, and reserved ranges. */
  private isForbiddenAddress(address: string): boolean {
    if (isIP(address) === 6) {
      const v6 = address.toLowerCase();
      if (v6 === "::1" || v6 === "::") return true;
      if (v6.startsWith("fe80") || v6.startsWith("fc") || v6.startsWith("fd")) {
        return true;
      }
      // IPv4-mapped IPv6 (::ffff:127.0.0.1) must be checked as IPv4.
      const mapped = v6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
      return mapped?.[1] ? this.isForbiddenAddress(mapped[1]) : false;
    }

    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    if (a === undefined || b === undefined) return true;

    if (a === 0 || a === 127) return true; // this host, loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local, cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast and reserved
    return false;
  }

  private async assertPublicHost(raw: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new ProblemException("invalid_request", "That is not a valid URL.");
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ProblemException(
        "invalid_request",
        "Only http and https URLs are supported.",
      );
    }

    const literal = isIP(url.hostname);
    const addresses = literal
      ? [url.hostname]
      : (await lookup(url.hostname, { all: true }).catch(() => [])).map(
          (entry) => entry.address,
        );

    if (addresses.length === 0) {
      throw new ProblemException(
        "invalid_request",
        "That host could not be resolved.",
      );
    }

    // Every resolved address must be public — one private answer is enough to refuse.
    for (const address of addresses) {
      if (this.isForbiddenAddress(address)) {
        throw new ProblemException(
          "invalid_request",
          "That URL points at a private address.",
          `blocked SSRF attempt to ${url.hostname} (${address})`,
        );
      }
    }

    return url;
  }

  /** Pre-flight used at ingest: validates shape and destination without downloading. */
  async assertFetchable(rawUrl: string): Promise<void> {
    await this.assertPublicHost(rawUrl);
  }

  async fetchAudio(rawUrl: string): Promise<FetchedAudio> {
    const url = await this.assertPublicHost(rawUrl);
    const maxBytes = this.config.get<number>("UPLOAD_MAX_BYTES") ?? 104_857_600;

    // Redirects are followed by hand, revalidating every hop. Refusing them outright
    // breaks ordinary file hosts (most 301 to a CDN); following them blindly hands the
    // SSRF check back to whoever controls the first URL.
    let target = url;
    let response: Response | undefined;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      response = await fetch(target, {
        redirect: "manual",
        signal: AbortSignal.timeout(120_000),
        headers: { accept: "audio/*,*/*" },
      }).catch((error: unknown) => {
        throw new ProblemException(
          "invalid_request",
          "Could not download that URL.",
          `${target} — ${error instanceof Error ? error.message : String(error)}`,
        );
      });

      if (response.status < 300 || response.status >= 400) break;

      const location = response.headers.get("location");
      if (!location) {
        throw new ProblemException(
          "invalid_request",
          "That link redirected somewhere we could not follow.",
          `${response.status} with no Location at ${target}`,
        );
      }

      if (hop === MAX_REDIRECTS) {
        throw new ProblemException(
          "invalid_request",
          "That link redirected too many times.",
        );
      }

      // Each destination is validated exactly like the original.
      target = await this.assertPublicHost(new URL(location, target).toString());
    }

    if (!response) {
      throw new ProblemException("invalid_request", "Could not download that URL.");
    }

    if (!response.ok) {
      // 401/403 almost always means the link is a page on a site that blocks
      // server-side fetches, not a direct file. Saying "403" helps nobody.
      const detail =
        response.status === 401 || response.status === 403
          ? "That site refused the download. Link directly to the audio file rather than the page it sits on."
          : response.status === 404
            ? "That link could not be found."
            : `The link returned ${response.status}.`;
      throw new ProblemException("invalid_request", detail, `GET ${url} -> ${response.status}`);
    }

    // A page URL returns HTML and would otherwise fail later as "unsupported media",
    // which reads like the audio is wrong rather than the link.
    const contentType = response.headers.get("content-type") ?? "";
    if (/^text\/html|^application\/xhtml/.test(contentType)) {
      throw new ProblemException(
        "invalid_request",
        "That link is a web page, not an audio file. Use the direct file URL (ending in .mp3, .wav, .m4a or .webm).",
        `content-type ${contentType} at ${url}`,
      );
    }

    // Trust the advertised length only as an early exit; the real cap is on bytes read.
    const advertised = Number(response.headers.get("content-length") ?? 0);
    if (advertised > maxBytes) {
      throw new ProblemException(
        "upload_too_large",
        `That file is larger than the ${Math.floor(maxBytes / 1_048_576)} MB limit.`,
      );
    }

    const chunks: Buffer[] = [];
    let total = 0;
    const body = response.body;
    if (!body) {
      throw new ProblemException("invalid_request", "That URL returned no data.");
    }

    for await (const chunk of body) {
      const buf = Buffer.from(chunk as Uint8Array);
      total += buf.byteLength;
      if (total > maxBytes) {
        throw new ProblemException(
          "upload_too_large",
          `That file is larger than the ${Math.floor(maxBytes / 1_048_576)} MB limit.`,
        );
      }
      chunks.push(buf);
    }

    const fileName = decodeURIComponent(target.pathname.split("/").pop() || "download");
    this.logger.log(`Fetched ${total} bytes from ${target.hostname}`);

    return {
      buffer: Buffer.concat(chunks),
      declaredType: response.headers.get("content-type"),
      fileName,
    };
  }
}
