import type { PageAnalysis } from '../crawl/analyse';
import type { AnswerSurface, CrawlOutcome } from '../crawl/crawler';
import { blocksEveryone, type AiAccess, type RobotsTxt } from '../crawl/robots';

export type PillarId =
  | 'crawler_access'
  | 'no_js_content'
  | 'structured_data'
  | 'answerability'
  | 'answer_surface'
  | 'entity_clarity';

export const PILLARS: { id: PillarId; label: string; weight: number; blurb: string }[] = [
  {
    id: 'crawler_access',
    label: 'AI crawler access',
    weight: 25,
    blurb: 'Whether the assistants are allowed to fetch your pages at all.',
  },
  {
    id: 'no_js_content',
    label: 'Content without JavaScript',
    weight: 20,
    blurb: 'AI crawlers rarely run JavaScript. Whatever only appears after hydration is invisible.',
  },
  {
    id: 'structured_data',
    label: 'Structured data',
    weight: 20,
    blurb: 'Valid JSON-LD is how an engine works out what you are and who you are.',
  },
  {
    id: 'answerability',
    label: 'Answerability',
    weight: 15,
    blurb: 'One H1, a clean heading outline, FAQ blocks and short direct answers to lift.',
  },
  {
    id: 'answer_surface',
    label: 'Answer surface',
    weight: 10,
    blurb: 'llms.txt, llms-full.txt and a working sitemap — the files that brief an LLM.',
  },
  {
    id: 'entity_clarity',
    label: 'Entity clarity',
    weight: 10,
    blurb: 'A consistent brand name, sameAs links and author markup so you resolve to one entity.',
  },
];

export const PILLAR_BY_ID = Object.fromEntries(PILLARS.map((p) => [p.id, p])) as Record<
  PillarId,
  (typeof PILLARS)[number]
>;

/** One scored check. `score` is 0–1; `weight` is its share of the pillar. */
export type CheckResult = {
  code: string;
  pillar: PillarId;
  label: string;
  score: number;
  weight: number;
  passed: boolean;
  detail: string;
  evidence?: Record<string, unknown>;
  affected?: string[];
};

export type PillarScore = {
  id: PillarId;
  label: string;
  weight: number;
  /** 0–100 within the pillar. */
  score: number;
  /** Contribution to the overall score, out of `weight`. */
  points: number;
  checks: CheckResult[];
};

export type AeoScore = {
  overall: number;
  /** What the weighted pillars alone produced, before any ceiling. */
  rawOverall: number;
  ceiling: ScoreCeiling | null;
  grade: string;
  pillars: PillarScore[];
  checks: CheckResult[];
  summary: string;
};

/**
 * The crawlers that gate an entire answer engine. If one of these is blocked, the site is
 * not "slightly less visible" in that engine — it is absent from it.
 */
export const PRIMARY_AGENTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ClaudeBot',
  'PerplexityBot',
  'Google-Extended',
] as const;

/**
 * Score ceilings.
 *
 * Weighted averaging alone understates a hard block: losing one check out of a few dozen
 * moves the total by a handful of points, so a site ChatGPT cannot read could still grade
 * an A on the strength of its schema and headings. That would be a misleading headline
 * number, which is the one thing a client actually reads. A blocked primary crawler
 * therefore caps the score outright, and the reason is carried through to the report so
 * the cap is explained rather than mysterious.
 */
const CEILING_ALL_BLOCKED = 25;
const CEILING_PRIMARY_BLOCKED = 60;

export type ScoreCeiling = { cap: number; reason: string };

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const pct = (n: number, d: number) => (d > 0 ? n / d : 0);

/** Pages that returned usable HTML. Error pages are excluded from content ratios. */
function usablePages(pages: PageAnalysis[]): PageAnalysis[] {
  return pages.filter((p) => !p.error && (p.statusCode ?? 0) < 400);
}

// ───────────────────────────── pillar: crawler access ─────────────────────────

function crawlerAccessChecks(robots: RobotsTxt, aiAccess: AiAccess[]): CheckResult[] {
  const checks: CheckResult[] = [];

  for (const agent of aiAccess) {
    const isCritical = (PRIMARY_AGENTS as readonly string[]).includes(agent.ua);
    checks.push({
      code: `robots.${agent.ua.toLowerCase()}_access`,
      pillar: 'crawler_access',
      label: `${agent.label} can crawl the site`,
      score: agent.allowed ? 1 : 0,
      weight: isCritical ? 2 : 0.3,
      passed: agent.allowed,
      detail: agent.allowed
        ? `${agent.label} (${agent.vendor}) is allowed. Used for ${agent.purpose}.`
        : `${agent.label} (${agent.vendor}) is blocked by robots.txt, so ${agent.purpose} cannot see your content.`,
      evidence: { ua: agent.ua, explicitlyBlocked: agent.explicitlyBlocked, mentioned: agent.mentioned },
    });
  }

  const everyoneBlocked = blocksEveryone(robots);
  checks.push({
    code: 'robots.wildcard_blocks_all',
    pillar: 'crawler_access',
    label: 'robots.txt does not block every crawler',
    score: everyoneBlocked ? 0 : 1,
    weight: 1.5,
    passed: !everyoneBlocked,
    detail: everyoneBlocked
      ? 'robots.txt contains `User-agent: *` with `Disallow: /`, which blocks the entire site for every crawler that has no rule of its own.'
      : 'No blanket site-wide disallow.',
  });

  const reachable = robots.fetched && robots.statusCode !== null && robots.statusCode < 400;
  checks.push({
    code: 'robots.reachable',
    pillar: 'crawler_access',
    label: 'robots.txt is reachable',
    score: reachable ? 1 : 0.5,
    weight: 0.5,
    passed: reachable,
    detail: reachable
      ? `robots.txt returned ${robots.statusCode}.`
      : 'No robots.txt was served. Everything is technically allowed, but you have no way to state crawl preferences.',
    evidence: { statusCode: robots.statusCode },
  });

  return checks;
}

// ───────────────────────────── pillar: no-JS content ──────────────────────────

function noJsChecks(pages: PageAnalysis[]): CheckResult[] {
  const usable = usablePages(pages);
  if (!usable.length) {
    return [
      {
        code: 'nojs.no_pages',
        pillar: 'no_js_content',
        label: 'Pages returned HTML',
        score: 0,
        weight: 1,
        passed: false,
        detail: 'No page returned usable HTML, so content rendering could not be assessed.',
      },
    ];
  }

  const jsDependent = usable.filter((p) => p.jsDependent);
  const serverRenderedRatio = 1 - pct(jsDependent.length, usable.length);
  const thin = usable.filter((p) => p.wordCount < 300);
  const medianWords = median(usable.map((p) => p.wordCount));

  return [
    {
      code: 'nojs.server_rendered',
      pillar: 'no_js_content',
      label: 'Content is present without JavaScript',
      score: clamp01(serverRenderedRatio),
      weight: 3,
      passed: jsDependent.length === 0,
      detail: jsDependent.length
        ? `${jsDependent.length} of ${usable.length} crawled pages have little or no content in the raw HTML. AI crawlers largely do not execute JavaScript, so those pages read as near-empty.`
        : `All ${usable.length} crawled pages serve their content in the raw HTML.`,
      evidence: {
        jsDependent: jsDependent.length,
        total: usable.length,
        reasons: [...new Set(jsDependent.map((p) => p.jsDependentReason).filter(Boolean))].slice(0, 3),
      },
      affected: jsDependent.map((p) => p.url).slice(0, 25),
    },
    {
      code: 'nojs.sufficient_depth',
      pillar: 'no_js_content',
      label: 'Pages carry enough text to be quotable',
      score: clamp01(1 - pct(thin.length, usable.length)),
      weight: 1,
      passed: thin.length <= usable.length * 0.3,
      detail: thin.length
        ? `${thin.length} of ${usable.length} pages hold under 300 words. Median is ${medianWords}. Thin pages rarely get cited because there is nothing substantive to quote.`
        : `Median page length is ${medianWords} words.`,
      evidence: { thin: thin.length, total: usable.length, medianWords },
      affected: thin.map((p) => p.url).slice(0, 25),
    },
  ];
}

// ─────────────────────────── pillar: structured data ──────────────────────────

const GROUNDING_TYPES = ['Organization', 'LocalBusiness', 'WebSite', 'Person'];
const CONTENT_TYPES = ['Article', 'BlogPosting', 'NewsArticle', 'Product', 'Service', 'Recipe', 'Event', 'Course'];

function structuredDataChecks(pages: PageAnalysis[]): CheckResult[] {
  const usable = usablePages(pages);
  if (!usable.length) return [];

  const withJsonLd = usable.filter((p) => p.jsonldBlocks > 0);
  const withInvalid = usable.filter((p) => p.jsonldInvalid > 0);
  const allTypes = new Set(usable.flatMap((p) => p.jsonldTypes));
  const hasGrounding = GROUNDING_TYPES.some((t) => allTypes.has(t));
  const hasContentType = CONTENT_TYPES.some((t) => allTypes.has(t));
  const hasBreadcrumb = allTypes.has('BreadcrumbList');

  return [
    {
      code: 'schema.present',
      pillar: 'structured_data',
      label: 'Pages carry JSON-LD structured data',
      score: clamp01(pct(withJsonLd.length, usable.length)),
      weight: 2.5,
      passed: withJsonLd.length === usable.length,
      detail: withJsonLd.length
        ? `${withJsonLd.length} of ${usable.length} pages include JSON-LD.`
        : 'No page includes JSON-LD. Engines then have to infer what you are from prose alone.',
      evidence: { withJsonLd: withJsonLd.length, total: usable.length, types: [...allTypes].slice(0, 20) },
      affected: usable.filter((p) => p.jsonldBlocks === 0).map((p) => p.url).slice(0, 25),
    },
    {
      code: 'schema.valid',
      pillar: 'structured_data',
      label: 'JSON-LD parses and declares @type',
      score: withJsonLd.length ? clamp01(1 - pct(withInvalid.length, withJsonLd.length)) : 0,
      weight: 2,
      passed: withInvalid.length === 0,
      detail: withInvalid.length
        ? `${withInvalid.length} page(s) have JSON-LD that either fails to parse or declares no @type. Invalid blocks are discarded wholesale, not partially read.`
        : withJsonLd.length
          ? 'All JSON-LD blocks parse and declare a @type.'
          : 'No JSON-LD to validate.',
      evidence: { invalid: withInvalid.length, withJsonLd: withJsonLd.length },
      affected: withInvalid.map((p) => p.url).slice(0, 25),
    },
    {
      code: 'schema.entity_grounding',
      pillar: 'structured_data',
      label: 'An Organization, LocalBusiness or WebSite entity is declared',
      score: hasGrounding ? 1 : 0,
      weight: 1.5,
      passed: hasGrounding,
      detail: hasGrounding
        ? `Entity grounding present: ${GROUNDING_TYPES.filter((t) => allTypes.has(t)).join(', ')}.`
        : 'No Organization, LocalBusiness or WebSite schema anywhere on the crawled pages. This is the block that tells an engine who the site belongs to.',
      evidence: { found: [...allTypes] },
    },
    {
      code: 'schema.content_type',
      pillar: 'structured_data',
      label: 'Content pages declare a content type',
      score: hasContentType ? 1 : 0,
      weight: 1,
      passed: hasContentType,
      detail: hasContentType
        ? `Content typing present: ${CONTENT_TYPES.filter((t) => allTypes.has(t)).join(', ')}.`
        : 'No Article, Product, Service or similar content type found, so engines cannot tell an article from a landing page.',
    },
    {
      code: 'schema.breadcrumbs',
      pillar: 'structured_data',
      label: 'BreadcrumbList gives pages their place in the site',
      score: hasBreadcrumb ? 1 : 0,
      weight: 0.5,
      passed: hasBreadcrumb,
      detail: hasBreadcrumb
        ? 'BreadcrumbList schema found.'
        : 'No BreadcrumbList schema. Helpful but not decisive for AI citations.',
    },
  ];
}

// ───────────────────────────── pillar: answerability ──────────────────────────

function answerabilityChecks(pages: PageAnalysis[]): CheckResult[] {
  const usable = usablePages(pages);
  if (!usable.length) return [];

  const badH1 = usable.filter((p) => p.h1Count !== 1);
  const withSkips = usable.filter((p) => p.headingSkips > 0);
  const withFaq = usable.filter((p) => p.hasFaq);
  const withFaqSchema = usable.filter((p) => p.hasFaqSchema);
  const withDirect = usable.filter((p) => p.hasDirectAnswer);
  const withExtractable = usable.filter((p) => p.listCount > 0 || p.tableCount > 0);

  return [
    {
      code: 'answer.single_h1',
      pillar: 'answerability',
      label: 'Every page has exactly one H1',
      score: clamp01(1 - pct(badH1.length, usable.length)),
      weight: 1.5,
      passed: badH1.length === 0,
      detail: badH1.length
        ? `${badH1.length} of ${usable.length} pages have either no H1 or more than one. The H1 is the strongest single hint about what a page answers.`
        : 'Every crawled page has exactly one H1.',
      evidence: { bad: badH1.length, total: usable.length },
      affected: badH1.map((p) => `${p.url} (${p.h1Count} H1s)`).slice(0, 25),
    },
    {
      code: 'answer.heading_hierarchy',
      pillar: 'answerability',
      label: 'Heading levels do not skip',
      score: clamp01(1 - pct(withSkips.length, usable.length)),
      weight: 1,
      passed: withSkips.length === 0,
      detail: withSkips.length
        ? `${withSkips.length} page(s) jump heading levels (for example H2 straight to H4), which breaks the outline an engine uses to scope an answer.`
        : 'Heading hierarchy is clean across the crawl.',
      affected: withSkips.map((p) => `${p.url} (${p.headingSkips} skips)`).slice(0, 25),
    },
    {
      code: 'answer.faq_coverage',
      pillar: 'answerability',
      label: 'Question-and-answer content exists',
      score: clamp01(pct(withFaq.length, usable.length) * 1.5),
      weight: 2,
      passed: withFaq.length > 0,
      detail: withFaq.length
        ? `${withFaq.length} of ${usable.length} pages carry FAQ-shaped content${withFaqSchema.length ? `, ${withFaqSchema.length} with FAQPage schema` : ', though none with FAQPage schema'}.`
        : 'No FAQ-shaped content found. Question-and-answer blocks are the single most liftable format for AI answers.',
      evidence: { withFaq: withFaq.length, withFaqSchema: withFaqSchema.length, total: usable.length },
    },
    {
      code: 'answer.direct_answer',
      pillar: 'answerability',
      label: 'Pages open with a short, direct answer',
      score: clamp01(pct(withDirect.length, usable.length)),
      weight: 1.5,
      passed: withDirect.length >= usable.length * 0.5,
      detail: `${withDirect.length} of ${usable.length} pages open with a self-contained paragraph of 15–80 words. That paragraph is what gets quoted.`,
      evidence: { withDirect: withDirect.length, total: usable.length },
    },
    {
      code: 'answer.extractable_blocks',
      pillar: 'answerability',
      label: 'Lists and tables give engines structure to lift',
      score: clamp01(pct(withExtractable.length, usable.length)),
      weight: 1,
      passed: withExtractable.length >= usable.length * 0.5,
      detail: `${withExtractable.length} of ${usable.length} pages contain a list or table.`,
    },
  ];
}

// ──────────────────────────── pillar: answer surface ──────────────────────────

function answerSurfaceChecks(surface: AnswerSurface): CheckResult[] {
  return [
    {
      code: 'surface.llms_txt',
      pillar: 'answer_surface',
      label: '/llms.txt is published',
      score: surface.llmsTxt.present ? (surface.llmsTxt.wellFormed ? 1 : 0.6) : 0,
      weight: 2,
      passed: surface.llmsTxt.present && surface.llmsTxt.wellFormed,
      detail: surface.llmsTxt.present
        ? surface.llmsTxt.wellFormed
          ? `llms.txt is present and well-formed (${surface.llmsTxt.sections} sections, ${surface.llmsTxt.bytes} bytes).`
          : 'llms.txt exists but is not in the expected format — it should open with an H1 and list links under H2 sections.'
        : 'No /llms.txt. This is the file that tells an assistant what your site is and which pages matter.',
      evidence: surface.llmsTxt as unknown as Record<string, unknown>,
    },
    {
      code: 'surface.llms_full_txt',
      pillar: 'answer_surface',
      label: '/llms-full.txt is published',
      score: surface.llmsFullTxt.present ? 1 : 0,
      weight: 0.75,
      passed: surface.llmsFullTxt.present,
      detail: surface.llmsFullTxt.present
        ? `llms-full.txt is present (${surface.llmsFullTxt.bytes} bytes).`
        : 'No /llms-full.txt. Optional, but it lets an assistant read your full content in one fetch.',
    },
    {
      code: 'surface.sitemap',
      pillar: 'answer_surface',
      label: 'A sitemap is reachable',
      score: surface.sitemap.present ? 1 : 0,
      weight: 1.5,
      passed: surface.sitemap.present,
      detail: surface.sitemap.present
        ? `Sitemap found via ${surface.sitemap.source === 'robots' ? 'robots.txt' : '/sitemap.xml'} with ${surface.sitemap.urlCount} URLs.`
        : 'No reachable sitemap. Crawlers then have to discover every page by following links.',
      evidence: surface.sitemap as unknown as Record<string, unknown>,
    },
  ];
}

// ─────────────────────────── pillar: entity clarity ───────────────────────────

function entityClarityChecks(pages: PageAnalysis[], brandName?: string): CheckResult[] {
  const usable = usablePages(pages);
  if (!usable.length) return [];

  const allSameAs = new Set(usable.flatMap((p) => p.sameAs));
  const withAuthor = usable.filter((p) => p.author);
  const withFreshness = usable.filter((p) => p.dateModified);
  const withTitle = usable.filter((p) => p.title && p.title.length >= 10);
  const withMeta = usable.filter((p) => p.metaDescription);

  const brandChecks: CheckResult[] = [];
  if (brandName?.trim()) {
    const needle = brandName.trim().toLowerCase();
    const consistent = usable.filter((p) => (p.title ?? '').toLowerCase().includes(needle));
    brandChecks.push({
      code: 'entity.brand_in_title',
      pillar: 'entity_clarity',
      label: 'Brand name appears in page titles',
      score: clamp01(pct(consistent.length, usable.length)),
      weight: 1,
      passed: consistent.length >= usable.length * 0.7,
      detail: `"${brandName}" appears in ${consistent.length} of ${usable.length} page titles. Consistent naming is how an engine binds pages to one entity.`,
      evidence: { consistent: consistent.length, total: usable.length },
    });
  }

  return [
    ...brandChecks,
    {
      code: 'entity.same_as',
      pillar: 'entity_clarity',
      label: 'sameAs links connect the brand to known profiles',
      score: allSameAs.size >= 3 ? 1 : allSameAs.size > 0 ? 0.5 : 0,
      weight: 1.5,
      passed: allSameAs.size >= 3,
      detail: allSameAs.size
        ? `${allSameAs.size} sameAs link(s) found. These resolve your brand against profiles an engine already trusts.`
        : 'No sameAs links in your schema. Without them, an engine cannot connect your site to your LinkedIn, Wikidata or Companies House record.',
      evidence: { sameAs: [...allSameAs].slice(0, 10) },
    },
    {
      code: 'entity.author_markup',
      pillar: 'entity_clarity',
      label: 'Content declares an author',
      score: clamp01(pct(withAuthor.length, usable.length)),
      weight: 1,
      passed: withAuthor.length >= usable.length * 0.5,
      detail: `${withAuthor.length} of ${usable.length} pages declare an author.`,
    },
    {
      code: 'entity.freshness',
      pillar: 'entity_clarity',
      label: 'Pages expose a modified date',
      score: clamp01(pct(withFreshness.length, usable.length)),
      weight: 1,
      passed: withFreshness.length >= usable.length * 0.5,
      detail: `${withFreshness.length} of ${usable.length} pages expose a dateModified. Engines prefer content they can date.`,
    },
    {
      code: 'entity.titles',
      pillar: 'entity_clarity',
      label: 'Pages have substantive titles',
      score: clamp01(pct(withTitle.length, usable.length)),
      weight: 1,
      passed: withTitle.length === usable.length,
      detail: `${withTitle.length} of ${usable.length} pages have a title of 10 characters or more.`,
      affected: usable.filter((p) => !p.title || p.title.length < 10).map((p) => p.url).slice(0, 25),
    },
    {
      code: 'entity.meta_description',
      pillar: 'entity_clarity',
      label: 'Pages have a meta description',
      score: clamp01(pct(withMeta.length, usable.length)),
      weight: 0.5,
      passed: withMeta.length >= usable.length * 0.8,
      detail: `${withMeta.length} of ${usable.length} pages have a meta description.`,
    },
  ];
}

// ────────────────────────────────── assembly ──────────────────────────────────

export function scoreCrawl(outcome: CrawlOutcome, brandName?: string): AeoScore {
  const checks: CheckResult[] = [
    ...crawlerAccessChecks(outcome.robots, outcome.aiAccess),
    ...noJsChecks(outcome.pages),
    ...structuredDataChecks(outcome.pages),
    ...answerabilityChecks(outcome.pages),
    ...answerSurfaceChecks(outcome.answerSurface),
    ...entityClarityChecks(outcome.pages, brandName),
  ];

  const pillars: PillarScore[] = PILLARS.map((pillar) => {
    const own = checks.filter((c) => c.pillar === pillar.id);
    const totalWeight = own.reduce((s, c) => s + c.weight, 0);
    const earned = own.reduce((s, c) => s + c.score * c.weight, 0);
    const ratio = totalWeight > 0 ? earned / totalWeight : 0;
    return {
      id: pillar.id,
      label: pillar.label,
      weight: pillar.weight,
      score: Math.round(ratio * 100),
      points: Number((ratio * pillar.weight).toFixed(2)),
      checks: own,
    };
  });

  // Pillars with no applicable checks (e.g. a page that failed to load) are dropped
  // from the denominator rather than scored zero, so the number stays honest.
  const applicable = pillars.filter((p) => p.checks.length > 0);
  const weightSum = applicable.reduce((s, p) => s + p.weight, 0);
  const pointSum = applicable.reduce((s, p) => s + p.points, 0);
  const rawOverall = weightSum > 0 ? Math.round((pointSum / weightSum) * 100) : 0;

  const ceiling = ceilingFor(outcome.robots, outcome.aiAccess);
  const overall = ceiling ? Math.min(rawOverall, ceiling.cap) : rawOverall;

  return {
    overall,
    rawOverall,
    ceiling: ceiling && overall < rawOverall ? ceiling : null,
    grade: gradeFor(overall),
    pillars,
    checks,
    summary: summarise(overall, pillars, ceiling && overall < rawOverall ? ceiling : null),
  };
}

/** The tightest applicable ceiling, with the sentence that explains it. */
function ceilingFor(robots: RobotsTxt, aiAccess: AiAccess[]): ScoreCeiling | null {
  if (blocksEveryone(robots)) {
    const anyAllowed = aiAccess.some((a) => a.allowed);
    if (!anyAllowed) {
      return {
        cap: CEILING_ALL_BLOCKED,
        reason:
          'robots.txt blocks every crawler site-wide, so no AI engine can read this site. The score is capped until that is removed.',
      };
    }
  }

  const blocked = aiAccess.filter(
    (a) => !a.allowed && (PRIMARY_AGENTS as readonly string[]).includes(a.ua),
  );
  if (blocked.length) {
    const names = blocked.map((b) => b.label).join(', ');
    return {
      cap: CEILING_PRIMARY_BLOCKED,
      reason: `${names} ${blocked.length === 1 ? 'is' : 'are'} blocked in robots.txt, so ${blocked.length === 1 ? 'that engine' : 'those engines'} cannot read this site at all. The score is capped at ${CEILING_PRIMARY_BLOCKED} until access is restored.`,
    };
  }

  return null;
}

export function gradeFor(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 55) return 'D';
  if (score >= 40) return 'E';
  return 'F';
}

function summarise(
  overall: number,
  pillars: PillarScore[],
  ceiling: ScoreCeiling | null,
): string {
  if (ceiling) {
    return `${overall}/100. ${ceiling.reason}`;
  }

  const weakest = [...pillars]
    .filter((p) => p.checks.length > 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, 2);
  const names = weakest.map((p) => p.label.toLowerCase()).join(' and ');

  if (overall >= 85) {
    return `Strong AI-search readiness at ${overall}/100. The remaining gains are in ${names}.`;
  }
  if (overall >= 65) {
    return `Workable at ${overall}/100, with real headroom. ${capitalise(names)} are holding the score down.`;
  }
  if (overall >= 40) {
    return `Weak at ${overall}/100. ${capitalise(names)} need attention before AI engines will reliably cite this site.`;
  }
  return `Critical at ${overall}/100. ${capitalise(names)} are failing, and AI assistants are unlikely to read or cite this site as it stands.`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}
