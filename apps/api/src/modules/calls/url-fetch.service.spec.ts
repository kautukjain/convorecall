import { afterEach, describe, expect, it, vi } from "vitest";
import { UrlFetchService } from "./url-fetch.service.js";

const service = new UrlFetchService({ get: () => undefined } as never);

/**
 * Fetching a user-supplied URL from the server is an SSRF surface. These are the cases
 * that matter: a link that looks ordinary but points somewhere only the API host can
 * reach — the database, the loopback interface, or cloud instance metadata.
 */
describe("UrlFetchService.assertFetchable", () => {
  it("accepts an ordinary public https URL", async () => {
    await expect(
      service.assertFetchable("https://example.com/call.mp3"),
    ).resolves.toBeUndefined();
  });

  it("rejects a non-http scheme", async () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com/call.mp3",
      "gopher://example.com/",
    ]) {
      await expect(service.assertFetchable(url)).rejects.toMatchObject({
        code: "invalid_request",
      });
    }
  });

  it("rejects loopback", async () => {
    for (const url of [
      "http://127.0.0.1/call.mp3",
      "http://127.0.0.1:5433/",
      "http://[::1]/call.mp3",
    ]) {
      await expect(service.assertFetchable(url)).rejects.toMatchObject({
        code: "invalid_request",
      });
    }
  });

  it("rejects private ranges", async () => {
    for (const url of [
      "http://10.0.0.5/a.mp3",
      "http://172.16.0.1/a.mp3",
      "http://172.31.255.254/a.mp3",
      "http://192.168.1.1/a.mp3",
    ]) {
      await expect(service.assertFetchable(url)).rejects.toMatchObject({
        code: "invalid_request",
      });
    }
  });

  // The one that turns an SSRF into a credential leak on most cloud providers.
  it("rejects link-local, including cloud instance metadata", async () => {
    await expect(
      service.assertFetchable("http://169.254.169.254/latest/meta-data/"),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("rejects an IPv4-mapped IPv6 loopback", async () => {
    await expect(
      service.assertFetchable("http://[::ffff:127.0.0.1]/a.mp3"),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("rejects a hostname that resolves to loopback", async () => {
    // `localhost` is the obvious case, but any domain can be pointed at 127.0.0.1 —
    // which is why the check is on the resolved address, not the name.
    await expect(service.assertFetchable("http://localhost/a.mp3")).rejects.toMatchObject(
      { code: "invalid_request" },
    );
  });

  it("rejects malformed input", async () => {
    for (const url of ["not-a-url", "", "http://"]) {
      await expect(service.assertFetchable(url)).rejects.toMatchObject({
        code: "invalid_request",
      });
    }
  });
});

describe("UrlFetchService.fetchAudio redirects", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * The subtle attack: the first URL is perfectly public, and its 302 points at the
   * metadata endpoint. Following redirects natively would hand the SSRF check to
   * whoever controls that first host.
   */
  it("revalidates each hop and refuses a redirect to a private address", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        }),
      ),
    );

    await expect(
      service.fetchAudio("https://example.com/call.mp3"),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("refuses a redirect chain that never terminates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://example.com/again.mp3" },
        }),
      ),
    );

    await expect(
      service.fetchAudio("https://example.com/call.mp3"),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("explains a page URL rather than blaming the audio", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("<html><body>player</body></html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      ),
    );

    await expect(
      service.fetchAudio("https://example.com/some/page"),
    ).rejects.toMatchObject({
      code: "invalid_request",
      detail: expect.stringContaining("web page"),
    });
  });
});
