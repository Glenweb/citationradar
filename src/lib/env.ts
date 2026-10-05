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
};

export const isProd = process.env.NODE_ENV === 'production';
