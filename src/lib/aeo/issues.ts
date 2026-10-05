import { PILLAR_BY_ID, type AeoScore, type PillarId } from './score';

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Effort = 'low' | 'medium' | 'high';

export type Issue = {
  code: string;
  pillar: PillarId;
  pillarLabel: string;
  severity: Severity;
  effort: Effort;
  title: string;
  whatItMeans: string;
  whyItMatters: string;
  howToFix: string;
  codeSnippet: string | null;
  /** Overall-score points recoverable by fixing this. */
  impactPoints: number;
  /** impactPoints ÷ effort — the sort key for the fix list. */
  priorityScore: number;
  affectedCount: number;
  affectedSample: string[];
  evidence: Record<string, unknown>;
};

const EFFORT_DIVISOR: Record<Effort, number> = { low: 1, medium: 2, high: 3.5 };

type FixTemplate = {
  severity: Severity;
  effort: Effort;
  title: string;
  whatItMeans: string;
  whyItMatters: string;
  howToFix: string;
  codeSnippet?: string;
};

/**
 * The fix catalogue. Every entry is written to be pasted into a client report:
 * what it means in plain English, why it costs them, and the exact change to make.
 * This is deliberately the opposite of a raw issue dump.
 */
const CATALOGUE: Record<string, FixTemplate> = {
  'robots.gptbot_access': {
    severity: 'critical',
    effort: 'low',
    title: 'GPTBot is blocked in robots.txt',
    whatItMeans:
      'Your robots.txt tells OpenAI\'s crawler not to read your site. ChatGPT therefore has no current copy of your pages to cite.',
    whyItMatters:
      'ChatGPT is the largest AI answer surface. While GPTBot is blocked, no amount of content or schema work can get you cited there — the content never arrives.',
    howToFix:
      'Remove the Disallow rule for GPTBot in /robots.txt, or replace it with an explicit allow. Keep any paths you genuinely want excluded (checkout, account pages) and allow the rest.',
    codeSnippet: `# /robots.txt
User-agent: GPTBot
Allow: /
Disallow: /account/
Disallow: /checkout/`,
  },
  'robots.oai-searchbot_access': {
    severity: 'critical',
    effort: 'low',
    title: 'OAI-SearchBot is blocked in robots.txt',
    whatItMeans:
      'OAI-SearchBot is the crawler behind ChatGPT\'s live search results, and it is currently disallowed.',
    whyItMatters:
      'This is the crawler that feeds ChatGPT\'s browsing answers — the ones with links. Blocking it removes you from the results users actually click.',
    howToFix: 'Allow OAI-SearchBot in /robots.txt. It is a separate agent from GPTBot and must be named separately.',
    codeSnippet: `# /robots.txt
User-agent: OAI-SearchBot
Allow: /`,
  },
  'robots.claudebot_access': {
    severity: 'high',
    effort: 'low',
    title: 'ClaudeBot is blocked in robots.txt',
    whatItMeans: 'Anthropic\'s crawler is disallowed, so Claude cannot read or cite your pages.',
    whyItMatters:
      'Claude is a fast-growing answer surface, heavily used in professional and B2B contexts where buying intent is high.',
    howToFix: 'Allow ClaudeBot in /robots.txt.',
    codeSnippet: `# /robots.txt
User-agent: ClaudeBot
Allow: /`,
  },
  'robots.perplexitybot_access': {
    severity: 'high',
    effort: 'low',
    title: 'PerplexityBot is blocked in robots.txt',
    whatItMeans: 'Perplexity\'s crawler is disallowed, so it has no copy of your content to cite.',
    whyItMatters:
      'Perplexity shows numbered source links on every answer, so it sends more referral clicks per citation than any other engine. Being absent there is a direct traffic loss.',
    howToFix: 'Allow PerplexityBot in /robots.txt.',
    codeSnippet: `# /robots.txt
User-agent: PerplexityBot
Allow: /`,
  },
  'robots.google-extended_access': {
    severity: 'high',
    effort: 'low',
    title: 'Google-Extended is blocked in robots.txt',
    whatItMeans:
      'Google-Extended controls whether your content can ground Gemini and AI Overviews. It is currently disallowed.',
    whyItMatters:
      'AI Overviews sit above the organic results on a large share of searches. Blocking Google-Extended keeps you out of that block while your competitors appear in it. Note this is separate from ordinary Googlebot indexing.',
    howToFix:
      'Allow Google-Extended in /robots.txt. This does not affect classic Google ranking, which is governed by Googlebot.',
    codeSnippet: `# /robots.txt
User-agent: Google-Extended
Allow: /`,
  },
  'robots.ccbot_access': {
    severity: 'low',
    effort: 'low',
    title: 'CCBot (Common Crawl) is blocked',
    whatItMeans: 'Common Crawl cannot archive your site.',
    whyItMatters:
      'Common Crawl feeds many open models and smaller answer engines. Lower priority than the named assistants, but it is free reach.',
    howToFix: 'Allow CCBot in /robots.txt if you are comfortable with open archiving.',
    codeSnippet: `# /robots.txt
User-agent: CCBot
Allow: /`,
  },
  'robots.wildcard_blocks_all': {
    severity: 'critical',
    effort: 'low',
    title: 'robots.txt blocks every crawler site-wide',
    whatItMeans:
      'Your robots.txt contains `User-agent: *` with `Disallow: /`, which blocks the whole site for every crawler that has no rule of its own.',
    whyItMatters:
      'This is the single most damaging configuration for AI visibility, and it is usually left over from a staging deploy. Nothing else on this report matters until it is removed.',
    howToFix:
      'Replace the blanket disallow with an empty Disallow (which means "allow everything"), then add specific Disallow lines only for paths that genuinely must stay private.',
    codeSnippet: `# /robots.txt
User-agent: *
Disallow:

Sitemap: https://example.com/sitemap.xml`,
  },
  'robots.reachable': {
    severity: 'low',
    effort: 'low',
    title: 'No robots.txt is served',
    whatItMeans: 'Requesting /robots.txt does not return a file.',
    whyItMatters:
      'Everything is allowed by default, so nothing is blocked — but you also cannot state a crawl preference, declare your sitemap, or explicitly welcome the AI crawlers.',
    howToFix: 'Publish a /robots.txt that allows the AI crawlers and declares your sitemap.',
    codeSnippet: `# /robots.txt
User-agent: *
Disallow:

User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

Sitemap: https://example.com/sitemap.xml`,
  },

  'nojs.server_rendered': {
    severity: 'critical',
    effort: 'high',
    title: 'Content only appears after JavaScript runs',
    whatItMeans:
      'The HTML your server returns is close to empty — the text only appears once the browser has executed JavaScript and hydrated the page.',
    whyItMatters:
      'AI crawlers overwhelmingly do not execute JavaScript. They see what curl sees. On these pages that is a near-blank document, so there is nothing to quote and nothing to cite, however good the content looks in a browser.',
    howToFix:
      'Server-render the main content. In Next.js, move the content out of client components and render it on the server (App Router server components, or getServerSideProps / getStaticProps on Pages Router). In other frameworks, enable SSR or prerendering. Verify with `curl -s https://yoursite.com/page | grep "a sentence from your copy"` — if grep finds nothing, neither will the crawler.',
    codeSnippet: `# Verify what a crawler actually receives:
curl -sA "GPTBot" https://example.com/your-page | \\
  sed -e 's/<[^>]*>//g' | tr -s '[:space:]' ' ' | head -c 600`,
  },
  'nojs.sufficient_depth': {
    severity: 'medium',
    effort: 'medium',
    title: 'Pages are too thin to be quoted',
    whatItMeans: 'A significant share of pages hold under 300 words of body text.',
    whyItMatters:
      'Engines cite passages, not pages. A thin page offers no passage substantial enough to lift, so it loses to a competitor\'s fuller treatment of the same question.',
    howToFix:
      'Expand the thin pages listed below to answer the question completely: a direct answer up front, then the detail, specifics, numbers and a short FAQ. Target 600+ words where the topic justifies it. Merge pages that are too thin to stand alone.',
  },
  'nojs.no_pages': {
    severity: 'critical',
    effort: 'medium',
    title: 'No page returned usable HTML',
    whatItMeans: 'Every URL attempted either failed, timed out, or returned something other than HTML.',
    whyItMatters: 'If our crawler cannot fetch the site, neither can the AI crawlers.',
    howToFix:
      'Check that the site is reachable over HTTPS from outside your network, that it is not behind a bot-blocking WAF rule, and that it returns a 200 with Content-Type: text/html. Bot-protection services frequently block unknown user agents, including the AI crawlers.',
  },

  'schema.present': {
    severity: 'high',
    effort: 'medium',
    title: 'Pages are missing JSON-LD structured data',
    whatItMeans: 'There is no machine-readable description of what these pages are.',
    whyItMatters:
      'JSON-LD is the most reliable channel for telling an engine what you are, what you sell and who you are. Without it, the engine has to infer everything from prose, and it frequently infers wrong — or attributes your content to someone else.',
    howToFix:
      'Add a JSON-LD block to every template. At minimum: Organization on the home page, WebSite with SearchAction site-wide, and an appropriate content type (Article, Product, Service) on content pages.',
    codeSnippet: `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Your Brand",
  "url": "https://example.com",
  "logo": "https://example.com/logo.png",
  "description": "What you do, in one sentence.",
  "sameAs": [
    "https://www.linkedin.com/company/your-brand",
    "https://x.com/yourbrand"
  ]
}
</script>`,
  },
  'schema.valid': {
    severity: 'high',
    effort: 'low',
    title: 'Some JSON-LD is invalid and silently ignored',
    whatItMeans:
      'At least one JSON-LD block either fails to parse as JSON or declares no @type.',
    whyItMatters:
      'Parsers discard an invalid block whole. You are paying the implementation cost of structured data and getting none of the benefit — and because it fails silently, nobody notices.',
    howToFix:
      'Validate each block at validator.schema.org. The usual culprits are a trailing comma, an unescaped quote inside a string, a template variable that rendered empty, or a missing @type.',
    codeSnippet: `# Extract and validate every JSON-LD block on a page:
curl -s https://example.com/page \\
  | grep -oP '(?<=<script type="application/ld\\+json">)[\\s\\S]*?(?=</script>)' \\
  | while read -r b; do echo "$b" | jq . >/dev/null || echo "INVALID: $b"; done`,
  },
  'schema.entity_grounding': {
    severity: 'high',
    effort: 'low',
    title: 'No Organization or LocalBusiness entity is declared',
    whatItMeans:
      'Nothing in your markup states who owns this site as a structured entity.',
    whyItMatters:
      'This is the block that binds every page to one brand. Without it an engine may treat your pages as unattributed content, cite the publication rather than you, or confuse you with a similarly named business.',
    howToFix:
      'Add Organization (or LocalBusiness, if you serve a physical area) to the home page, with name, url, logo and sameAs. For a local business add address, telephone and openingHours.',
    codeSnippet: `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "Your Brand",
  "url": "https://example.com",
  "telephone": "+44 20 1234 5678",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "1 High Street",
    "addressLocality": "London",
    "postalCode": "W1A 1AA",
    "addressCountry": "GB"
  },
  "sameAs": ["https://www.linkedin.com/company/your-brand"]
}
</script>`,
  },
  'schema.content_type': {
    severity: 'medium',
    effort: 'low',
    title: 'Content pages do not declare a content type',
    whatItMeans: 'No Article, Product, Service or similar type was found.',
    whyItMatters:
      'Content typing is how an engine tells an article from a product page from a landing page, and decides which of your pages answers which kind of question.',
    howToFix: 'Add the appropriate type to each content template, with headline, author, datePublished and dateModified.',
    codeSnippet: `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "The exact H1 of this page",
  "author": { "@type": "Person", "name": "Author Name" },
  "publisher": { "@type": "Organization", "name": "Your Brand" },
  "datePublished": "2026-01-15",
  "dateModified": "2026-10-05"
}
</script>`,
  },
  'schema.breadcrumbs': {
    severity: 'low',
    effort: 'low',
    title: 'No BreadcrumbList schema',
    whatItMeans: 'Pages do not declare their position in the site hierarchy.',
    whyItMatters: 'Minor for AI citations, but it helps an engine understand topical grouping.',
    howToFix: 'Add BreadcrumbList to templates that sit below the top level.',
    codeSnippet: `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://example.com" },
    { "@type": "ListItem", "position": 2, "name": "Guides", "item": "https://example.com/guides" }
  ]
}
</script>`,
  },

  'answer.single_h1': {
    severity: 'medium',
    effort: 'low',
    title: 'Pages have no H1, or more than one',
    whatItMeans: 'Some pages are missing an H1 entirely; others declare several.',
    whyItMatters:
      'The H1 is the strongest single signal of what a page answers. Multiple H1s split that signal; none leaves the engine guessing from the title tag alone.',
    howToFix:
      'One H1 per page, matching the question the page answers. Demote the extras to H2. Watch for templates where a logo or site name is marked up as an H1.',
  },
  'answer.heading_hierarchy': {
    severity: 'low',
    effort: 'low',
    title: 'Heading levels skip',
    whatItMeans: 'Pages jump from H2 straight to H4, or similar.',
    whyItMatters:
      'Engines use the heading outline to decide where an answer starts and stops. A broken outline means a lifted passage can carry the wrong scope.',
    howToFix: 'Use heading levels for structure, not size. Never skip a level; style with CSS instead.',
  },
  'answer.faq_coverage': {
    severity: 'high',
    effort: 'medium',
    title: 'No question-and-answer content',
    whatItMeans: 'No FAQ-shaped content or FAQPage schema was found.',
    whyItMatters:
      'A question as a heading with a short answer underneath is the most liftable format there is: it matches how users prompt, and it gives the engine a passage it can quote whole. This is usually the single highest-return content change for AI citations.',
    howToFix:
      'Add 5–8 real customer questions to your main pages as H2 or H3 headings, each with a 40–60 word direct answer underneath, then mark the block up as FAQPage. Take the questions from sales calls and support tickets, not a keyword tool.',
    codeSnippet: `<h2>How long does delivery take?</h2>
<p>UK orders placed before 2pm ship the same working day and arrive
in two to three working days. Next-day delivery is available at
checkout for £4.95.</p>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [{
    "@type": "Question",
    "name": "How long does delivery take?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "UK orders placed before 2pm ship the same working day and arrive in two to three working days. Next-day delivery is available at checkout for £4.95."
    }
  }]
}
</script>`,
  },
  'answer.direct_answer': {
    severity: 'medium',
    effort: 'low',
    title: 'Pages do not open with a direct answer',
    whatItMeans:
      'The first paragraph is either too short to be useful or too long to be quoted as a unit.',
    whyItMatters:
      'Engines preferentially lift the first self-contained paragraph that answers the heading. A 15–80 word opener that answers the question outright is the passage most likely to be quoted verbatim, with your brand attached.',
    howToFix:
      'Open each page by answering its own headline in one tight paragraph, before any preamble or scene-setting. Then expand. Put the conclusion first, not last.',
  },
  'answer.extractable_blocks': {
    severity: 'low',
    effort: 'low',
    title: 'Few lists or tables',
    whatItMeans: 'Content is mostly unbroken prose.',
    whyItMatters:
      'Comparison tables and ordered lists are easy for an engine to lift intact, and they map directly onto "best X", "X vs Y" and "how to X" prompts.',
    howToFix: 'Convert comparisons to tables and processes to numbered lists.',
  },

  'surface.llms_txt': {
    severity: 'medium',
    effort: 'low',
    title: 'No /llms.txt',
    whatItMeans:
      'You do not publish an llms.txt — the plain-text file that tells an AI assistant what your site is and which pages matter.',
    whyItMatters:
      'It is a 20-minute job that puts your own summary of your business in front of the assistant, in your words, rather than leaving it to infer one. Adoption is still low, so it is a cheap edge.',
    howToFix: 'Publish /llms.txt: an H1 with your brand, a blockquote summary, then H2 sections listing your key pages as markdown links with one-line descriptions.',
    codeSnippet: `# Your Brand

> One-sentence description of what you do and who for.

## Core pages
- [Services](https://example.com/services): What we do and what it costs.
- [About](https://example.com/about): Who we are, founded 2015, based in London.
- [Contact](https://example.com/contact): How to reach us.

## Guides
- [Guide to X](https://example.com/guide-x): Covers A, B and C.

## Optional
- [Terms](https://example.com/terms)`,
  },
  'surface.llms_full_txt': {
    severity: 'low',
    effort: 'low',
    title: 'No /llms-full.txt',
    whatItMeans: 'You do not publish a single-file version of your full content.',
    whyItMatters: 'It lets an assistant read everything in one fetch rather than crawling page by page.',
    howToFix: 'Generate /llms-full.txt at build time by concatenating your main pages as markdown.',
  },
  'surface.sitemap': {
    severity: 'high',
    effort: 'low',
    title: 'No reachable sitemap',
    whatItMeans: 'Neither /sitemap.xml nor a sitemap declared in robots.txt could be fetched.',
    whyItMatters:
      'Without a sitemap, a crawler has to discover every page by following links. Anything not well linked internally may never be found, and new pages take far longer to appear.',
    howToFix: 'Generate a sitemap.xml with lastmod dates and declare it in robots.txt.',
    codeSnippet: `# /robots.txt
Sitemap: https://example.com/sitemap.xml`,
  },

  'entity.brand_in_title': {
    severity: 'medium',
    effort: 'low',
    title: 'Brand name is missing from many page titles',
    whatItMeans: 'Your brand name does not appear consistently in title tags.',
    whyItMatters:
      'Consistent naming is how an engine binds many pages to one entity. Inconsistent naming splits your authority across what look like several different businesses.',
    howToFix: 'Use a consistent title template: `Page topic | Your Brand`. Use exactly one spelling of the brand everywhere.',
  },
  'entity.same_as': {
    severity: 'medium',
    effort: 'low',
    title: 'No sameAs links in your schema',
    whatItMeans: 'Your structured data does not link your brand to any external profile.',
    whyItMatters:
      'sameAs is how you resolve against entities an engine already trusts — LinkedIn, Wikidata, Crunchbase, Companies House. It is the cheapest available way to raise entity confidence, which is what decides whether you get named.',
    howToFix: 'Add a sameAs array to your Organization schema listing every profile you control.',
    codeSnippet: `"sameAs": [
  "https://www.linkedin.com/company/your-brand",
  "https://x.com/yourbrand",
  "https://www.crunchbase.com/organization/your-brand",
  "https://www.wikidata.org/wiki/Q00000000"
]`,
  },
  'entity.author_markup': {
    severity: 'low',
    effort: 'low',
    title: 'Content does not declare an author',
    whatItMeans: 'Most pages have no author in schema or meta tags.',
    whyItMatters: 'Named, credentialed authors raise trust signals, which matter most in advice-led and regulated niches.',
    howToFix: 'Add an author to Article schema, pointing at a Person with a real bio page.',
  },
  'entity.freshness': {
    severity: 'low',
    effort: 'low',
    title: 'Pages do not expose a modified date',
    whatItMeans: 'Most pages carry no dateModified.',
    whyItMatters: 'Engines prefer content they can date, especially for anything time-sensitive. Undated content loses to dated content on recency.',
    howToFix: 'Emit dateModified in your content schema and update it whenever the page genuinely changes.',
  },
  'entity.titles': {
    severity: 'medium',
    effort: 'low',
    title: 'Some pages have missing or very short titles',
    whatItMeans: 'Pages were found with a title under 10 characters, or none at all.',
    whyItMatters: 'The title is a primary signal of page topic. A missing one wastes the clearest statement you get to make.',
    howToFix: 'Give every page a descriptive 40–60 character title that states what the page answers.',
  },
  'entity.meta_description': {
    severity: 'low',
    effort: 'low',
    title: 'Some pages have no meta description',
    whatItMeans: 'Pages are missing a meta description.',
    whyItMatters: 'A modest signal for AI answers, but it is a free summary in your own words.',
    howToFix: 'Write a 140–160 character description per page that summarises the answer.',
  },
};

/**
 * Turn failed checks into prioritised issues.
 *
 * `impactPoints` is the overall-score points a full fix would recover, computed from the
 * check's share of its pillar and the pillar's weight — so priority reflects the real
 * scoring model rather than a hand-assigned guess. `priorityScore` divides that by effort,
 * which is what makes the fix list a work queue rather than a ranking of severity.
 */
export function deriveIssues(score: AeoScore, applicablePillarWeight?: number): Issue[] {
  const totalWeight =
    applicablePillarWeight ??
    score.pillars.filter((p) => p.checks.length > 0).reduce((s, p) => s + p.weight, 0);

  const issues: Issue[] = [];

  for (const pillar of score.pillars) {
    const pillarCheckWeight = pillar.checks.reduce((s, c) => s + c.weight, 0);
    if (!pillarCheckWeight) continue;

    for (const check of pillar.checks) {
      if (check.score >= 0.999) continue;

      const template = CATALOGUE[check.code];
      if (!template) continue;

      // Points recoverable = unearned fraction × check's share of pillar × pillar's share
      // of the applicable total, scaled to 100.
      const shareOfPillar = check.weight / pillarCheckWeight;
      const pillarShare = totalWeight > 0 ? pillar.weight / totalWeight : 0;
      const impactPoints = Number(((1 - check.score) * shareOfPillar * pillarShare * 100).toFixed(2));

      issues.push({
        code: check.code,
        pillar: check.pillar,
        pillarLabel: PILLAR_BY_ID[check.pillar]?.label ?? check.pillar,
        severity: template.severity,
        effort: template.effort,
        title: template.title,
        whatItMeans: template.whatItMeans,
        whyItMatters: template.whyItMatters,
        howToFix: template.howToFix,
        codeSnippet: template.codeSnippet ?? null,
        impactPoints,
        priorityScore: Number((impactPoints / EFFORT_DIVISOR[template.effort]).toFixed(2)),
        affectedCount: check.affected?.length ?? 0,
        affectedSample: (check.affected ?? []).slice(0, 10),
        evidence: { ...(check.evidence ?? {}), detail: check.detail, checkScore: check.score },
      });
    }
  }

  // Critical issues always lead, regardless of effort — a blocked GPTBot outranks a
  // dozen cheap wins because nothing else can work until it is fixed.
  const severityRank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return issues.sort((a, b) => {
    if (a.severity === 'critical' || b.severity === 'critical') {
      const d = severityRank[a.severity] - severityRank[b.severity];
      if (d !== 0) return d;
    }
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    return severityRank[a.severity] - severityRank[b.severity];
  });
}

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const EFFORT_LABELS: Record<Effort, string> = {
  low: 'Quick win',
  medium: 'Half-day',
  high: 'Dev project',
};

export function hasTemplate(code: string): boolean {
  return code in CATALOGUE;
}
