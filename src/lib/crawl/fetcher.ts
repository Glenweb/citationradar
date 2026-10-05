import 'server-only';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { env } from '../env';

export type FetchResult = {
  ok: boolean;
  url: string;
  finalUrl: string;
  statusCode: number | null;
  contentType: string | null;
  body: string;
  bytes: number;
  latencyMs: number;
  error?: string;
  truncated: boolean;
};

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB — enough for any HTML document worth scoring
const MAX_REDIRECTS = 5;

/**
 * SSRF guard. The crawl target is attacker-supplied (anyone can paste a URL into the
 * free audit), so before fetching we refuse non-public destinations.
 */
function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const parts = ip.split('.').map(Number);
    const [a = 0, b = 0] = parts;
    if (a === 10) return true;                        // 10/8
    if (a === 127) return true;                       // loopback
    if (a === 0) return true;                         // this host
    if (a === 169 && b === 254) return true;          // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true;          // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true;// CGNAT
    if (a >= 224) return true;                        // multicast + reserved
    return false;
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (v6 === '::' || v6 === '::1') return true;
  if (v6.startsWith('fe80') || v6.startsWith('fc') || v6.startsWith('fd')) return true;
  // IPv4-mapped (::ffff:10.0.0.1)
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped?.[1]) return isPrivateAddress(mapped[1]);
  return false;
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

/** Validate a user-supplied URL and confirm it resolves to a public address. */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError(`"${raw}" is not a valid URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('Only http and https URLs can be audited.');
  }
  if (!url.hostname) throw new UnsafeUrlError('That URL has no hostname.');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) {
    throw new UnsafeUrlError('Local addresses cannot be audited.');
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URLs with embedded credentials cannot be audited.');
  }

  const literal = isIP(url.hostname.replace(/^\[|\]$/g, ''));
  if (literal) {
    if (isPrivateAddress(url.hostname)) {
      throw new UnsafeUrlError('Private and loopback addresses cannot be audited.');
    }
    return url;
  }

  try {
    const results = await lookup(url.hostname, { all: true, verbatim: true });
    if (!results.length) throw new UnsafeUrlError(`${url.hostname} did not resolve.`);
    if (results.some((r) => isPrivateAddress(r.address))) {
      throw new UnsafeUrlError('That hostname resolves to a private address.');
    }
  } catch (e) {
    if (e instanceof UnsafeUrlError) throw e;
    throw new UnsafeUrlError(`Could not resolve ${url.hostname}.`);
  }
  return url;
}

/**
 * Fetch a URL as a crawler would: no JS execution, redirects followed manually so each
 * hop is re-validated, response capped, HTML decoded as text.
 */
export async function fetchPage(rawUrl: string): Promise<FetchResult> {
  const started = Date.now();
  const base: FetchResult = {
    ok: false,
    url: rawUrl,
    finalUrl: rawUrl,
    statusCode: null,
    contentType: null,
    body: '',
    bytes: 0,
    latencyMs: 0,
    truncated: false,
  };

  let current: URL;
  try {
    current = await assertSafeUrl(rawUrl);
  } catch (e) {
    return { ...base, latencyMs: Date.now() - started, error: (e as Error).message };
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(current.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': env.crawlUserAgent(),
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
          'Accept-Language': 'en-GB,en;q=0.9',
        },
      });

      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        const next = new URL(location, current);
        try {
          current = await assertSafeUrl(next.toString());
        } catch (e) {
          return {
            ...base,
            finalUrl: next.toString(),
            statusCode: res.status,
            latencyMs: Date.now() - started,
            error: `Redirect blocked: ${(e as Error).message}`,
          };
        }
        continue;
      }

      const contentType = res.headers.get('content-type');
      const { text, bytes, truncated } = await readCapped(res);
      clearTimeout(timer);

      return {
        ok: res.ok,
        url: rawUrl,
        finalUrl: current.toString(),
        statusCode: res.status,
        contentType,
        body: text,
        bytes,
        truncated,
        latencyMs: Date.now() - started,
      };
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      return {
        ...base,
        finalUrl: current.toString(),
        latencyMs: Date.now() - started,
        error: aborted ? `Timed out after ${TIMEOUT_MS / 1000}s` : (e as Error).message,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ...base,
    finalUrl: current.toString(),
    latencyMs: Date.now() - started,
    error: `More than ${MAX_REDIRECTS} redirects`,
  };
}

/** Read a response body up to MAX_BYTES, decoding as UTF-8. */
async function readCapped(
  res: Response,
): Promise<{ text: string; bytes: number; truncated: boolean }> {
  if (!res.body) {
    const text = await res.text();
    return { text: text.slice(0, MAX_BYTES), bytes: text.length, truncated: false };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      chunks.push(value.subarray(0, value.byteLength - (total - MAX_BYTES)));
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }

  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return { text: buf.toString('utf8'), bytes: buf.byteLength, truncated };
}

/** Small helper for text resources (robots.txt, llms.txt, sitemap.xml). */
export async function fetchText(url: string): Promise<FetchResult> {
  return fetchPage(url);
}
