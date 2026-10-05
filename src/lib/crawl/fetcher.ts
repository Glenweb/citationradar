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

/**
 * Some hosts only permit outbound HTTP through a proxy. Node's fetch ignores the
 * standard proxy variables, so when one is set we install a dispatcher for it, lazily
 * and only for crawler traffic.
 */
let dispatcherReady = false;
let proxyDispatcher: unknown = null;

async function proxyAgent(): Promise<unknown> {
  if (dispatcherReady) return proxyDispatcher;
  dispatcherReady = true;

  const proxy = env.httpsProxy();
  if (!proxy) return null;
  try {
    const undici = (await import('undici')) as unknown as {
      ProxyAgent: new (uri: string) => unknown;
    };
    proxyDispatcher = new undici.ProxyAgent(proxy);
  } catch {
    // undici ships with Node, but if the import is unavailable we fetch directly
    // rather than failing the crawl.
    proxyDispatcher = null;
  }
  return proxyDispatcher;
}

/**
 * Should `url` bypass the proxy?
 *
 * Honouring NO_PROXY matters for correctness, not just tidiness: sending a loopback or
 * internal request to an external proxy gets it refused, and the crawler would then read
 * the proxy's own 403 as if it were the site's response — scoring a site on a page it
 * never served. Private and loopback destinations always bypass, whether or not they are
 * listed, because a proxy cannot reach them anyway.
 */
export function bypassesProxy(url: URL, noProxy = env.noProxy()): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (isIP(host) && isPrivateAddress(host)) return true;

  for (const raw of noProxy.split(',')) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    if (entry === '*') return true;

    // CIDR entries only apply to literal IP destinations.
    if (entry.includes('/')) {
      if (isIP(host) && inCidr(host, entry)) return true;
      continue;
    }

    const bare = entry.replace(/^\./, '');
    if (host === bare || host.endsWith(`.${bare}`)) return true;
  }
  return false;
}

/** IPv4 CIDR containment. IPv6 ranges are left to the private-address check above. */
function inCidr(ip: string, cidr: string): boolean {
  const [network, bitsRaw] = cidr.split('/');
  if (!network || isIP(network) !== 4 || isIP(ip) !== 4) return false;
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;

  const toInt = (addr: string) =>
    addr.split('.').reduce((acc, octet) => (acc << 8) + (Number(octet) & 255), 0) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(network) & mask);
}

/** The dispatcher to use for `url`: the proxy agent, or none if it bypasses. */
async function outboundDispatcher(url: URL): Promise<unknown> {
  if (bypassesProxy(url)) return null;
  return proxyAgent();
}

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
  if (
    !env.crawlAllowPrivateHosts() &&
    (url.hostname === 'localhost' || url.hostname.endsWith('.localhost'))
  ) {
    throw new UnsafeUrlError('Local addresses cannot be audited.');
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URLs with embedded credentials cannot be audited.');
  }

  const allowPrivate = env.crawlAllowPrivateHosts();

  const literal = isIP(url.hostname.replace(/^\[|\]$/g, ''));
  if (literal) {
    if (!allowPrivate && isPrivateAddress(url.hostname)) {
      throw new UnsafeUrlError('Private and loopback addresses cannot be audited.');
    }
    return url;
  }

  try {
    const results = await lookup(url.hostname, { all: true, verbatim: true });
    if (!results.length) throw new UnsafeUrlError(`${url.hostname} did not resolve.`);
    if (!allowPrivate && results.some((r) => isPrivateAddress(r.address))) {
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
      const dispatcher = await outboundDispatcher(current);
      const res = await fetch(current.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        ...(dispatcher ? ({ dispatcher } as Record<string, unknown>) : {}),
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
