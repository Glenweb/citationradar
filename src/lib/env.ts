/**
 * Central env access. Required vars throw at first use (not at import time, so that
 * `next build` can prerender static marketing pages without a database).
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return v;
}

function optional(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

export const env = {
  get databaseUrl() {
    return required('DATABASE_URL');
  },
  get sessionSecret() {
    const s = required('SESSION_SECRET');
    if (s.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters.');
    return s;
  },
  get appUrl() {
    return optional('APP_URL', 'http://localhost:3000').replace(/\/$/, '');
  },

  // Optional providers — absence is a supported state, not an error.
  anthropicKey: () => optional('ANTHROPIC_API_KEY'),
  anthropicModel: () => optional('ANTHROPIC_MODEL', 'claude-sonnet-5-5'),
  openaiKey: () => optional('OPENAI_API_KEY'),
  openaiModel: () => optional('OPENAI_MODEL', 'gpt-4o-mini'),
  perplexityKey: () => optional('PERPLEXITY_API_KEY'),
  perplexityModel: () => optional('PERPLEXITY_MODEL', 'sonar'),
  dataForSeoLogin: () => optional('DATAFORSEO_LOGIN'),
  dataForSeoPassword: () => optional('DATAFORSEO_PASSWORD'),

  stripeSecret: () => optional('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: () => optional('STRIPE_WEBHOOK_SECRET'),
  stripePrice: (plan: 'starter' | 'growth' | 'agency') =>
    optional(`STRIPE_PRICE_${plan.toUpperCase()}`),

  cronSecret: () => optional('CRON_SECRET'),
  n8nWebhookUrl: () => optional('N8N_WEBHOOK_URL'),

  crawlUserAgent: () =>
    optional('CRAWL_USER_AGENT', 'CitationRadarBot/1.0 (+https://citationradar.app/bot)'),
  crawlHardCap: () => Number(optional('CRAWL_MAX_PAGES_HARD_CAP', '2000')) || 2000,

  /**
   * Allow the crawler to reach private, loopback and link-local addresses.
   *
   * Off by default, because the free audit accepts a URL from anyone and the guard is
   * what stops it being used to probe an internal network. Turn it on only for a
   * trusted, non-public deployment — an agency auditing a staging site on its own
   * network, or local development.
   */
  crawlAllowPrivateHosts: () => optional('CRAWL_ALLOW_PRIVATE_HOSTS') === 'true',

  /** Outbound proxy for crawler requests, where the host requires one for egress. */
  httpsProxy: () =>
    optional('CRAWL_HTTPS_PROXY') || optional('HTTPS_PROXY') || optional('https_proxy'),

  /** Hosts that must bypass the proxy, in the usual comma-separated NO_PROXY form. */
  noProxy: () => optional('NO_PROXY') || optional('no_proxy'),
};

export const isProd = process.env.NODE_ENV === 'production';
