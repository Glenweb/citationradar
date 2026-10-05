export type PlanId = 'free' | 'starter' | 'growth' | 'agency';
export type EngineId = 'chatgpt' | 'perplexity' | 'google_aio' | 'claude';

export const ALL_ENGINES: EngineId[] = ['chatgpt', 'perplexity', 'google_aio', 'claude'];

export const ENGINE_LABELS: Record<EngineId, string> = {
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
  google_aio: 'Google AI Overviews',
  claude: 'Claude',
};

export type Plan = {
  id: PlanId;
  name: string;
  priceGbp: number;
  tagline: string;
  sites: number;
  pagesPerAudit: number;
  auditsPerMonth: number;
  prompts: number;
  engines: number;
  competitorsPerSite: number;
  weeklyAutoChecks: boolean;
  pdfExport: boolean;
  whiteLabel: boolean;
  shareLinks: boolean;
  apiAccess: boolean;
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    priceGbp: 0,
    tagline: 'See whether AI can read your site at all.',
    sites: 1,
    pagesPerAudit: 10,
    auditsPerMonth: 3,
    prompts: 3,
    engines: 1,
    competitorsPerSite: 1,
    weeklyAutoChecks: false,
    pdfExport: false,
    whiteLabel: false,
    shareLinks: false,
    apiAccess: false,
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    priceGbp: 29,
    tagline: 'One site, tracked properly.',
    sites: 1,
    pagesPerAudit: 100,
    auditsPerMonth: 30,
    prompts: 25,
    engines: 3,
    competitorsPerSite: 3,
    weeklyAutoChecks: true,
    pdfExport: true,
    whiteLabel: false,
    shareLinks: false,
    apiAccess: false,
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    priceGbp: 79,
    tagline: 'Multi-site, white-labelled, all four engines.',
    sites: 5,
    pagesPerAudit: 500,
    auditsPerMonth: 150,
    prompts: 150,
    engines: 4,
    competitorsPerSite: 10,
    weeklyAutoChecks: true,
    pdfExport: true,
    whiteLabel: true,
    shareLinks: true,
    apiAccess: true,
  },
  agency: {
    id: 'agency',
    name: 'Agency',
    priceGbp: 199,
    tagline: 'Client reporting at scale.',
    sites: 25,
    pagesPerAudit: 2000,
    auditsPerMonth: Number.POSITIVE_INFINITY,
    prompts: 750,
    engines: 4,
    competitorsPerSite: 25,
    weeklyAutoChecks: true,
    pdfExport: true,
    whiteLabel: true,
    shareLinks: true,
    apiAccess: true,
  },
};

export const PLAN_ORDER: PlanId[] = ['free', 'starter', 'growth', 'agency'];

export function planOf(id: string): Plan {
  return PLANS[(id as PlanId) in PLANS ? (id as PlanId) : 'free'];
}

/** Engines a plan may track, in priority order. */
export function enginesForPlan(id: PlanId): EngineId[] {
  return ALL_ENGINES.slice(0, PLANS[id].engines);
}

export function formatLimit(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString('en-GB') : 'Unlimited';
}
