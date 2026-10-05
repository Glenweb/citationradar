import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env';
import type { AeoScore } from './score';
import type { Issue } from './issues';

export type Recommendation = {
  /** Client-facing paragraph for the top of the report. */
  executiveSummary: string;
  /** Ordered, concrete next actions. */
  actionPlan: { title: string; detail: string; timeframe: string }[];
  /** Per-issue tailoring, keyed by issue code. Falls back to the catalogue copy. */
  tailored: Record<string, string>;
  aiGenerated: boolean;
};

export function anthropicConfigured(): boolean {
  return !!env.anthropicKey();
}

const MAX_ISSUES_SENT = 8;

/**
 * Ask Claude to turn the mechanical findings into client-ready prose and a sequenced
 * action plan. Without a key — or on any API failure — we fall back to deterministic
 * copy built from the same findings, so the report is never blank and never blocks.
 */
export async function recommend(
  score: AeoScore,
  issues: Issue[],
  context: { origin: string; brandName: string; pagesCrawled: number },
): Promise<Recommendation> {
  const fallback = staticRecommendation(score, issues, context);
  if (!anthropicConfigured()) return fallback;

  const top = issues.slice(0, MAX_ISSUES_SENT);
  const client = new Anthropic({ apiKey: env.anthropicKey() });

  const findings = top
    .map(
      (i, n) =>
        `${n + 1}. [${i.severity}/${i.effort}] ${i.title} (${i.pillarLabel}, ~${i.impactPoints} pts)\n` +
        `   Finding: ${String(i.evidence.detail ?? '').slice(0, 300)}\n` +
        (i.affectedSample.length ? `   Examples: ${i.affectedSample.slice(0, 3).join(', ')}\n` : ''),
    )
    .join('\n');

  const prompt = `You are writing the summary section of an AI-search visibility (AEO) audit for a client.

Site: ${context.origin}
Brand: ${context.brandName}
Pages crawled: ${context.pagesCrawled}
Overall AEO score: ${score.overall}/100 (grade ${score.grade})
Pillar scores: ${score.pillars.map((p) => `${p.label} ${p.score}/100`).join(', ')}

Findings, already ranked by impact ÷ effort:
${findings}

Return ONLY valid JSON matching this shape, with no markdown fence:
{
  "executiveSummary": "2-3 sentences for a non-technical business owner. State where they stand and the single most consequential thing to fix. No preamble, no greeting.",
  "actionPlan": [
    { "title": "short imperative", "detail": "1-2 sentences, specific to this site", "timeframe": "This week" }
  ],
  "tailored": { "<issue code>": "1-2 sentences tailored to this specific site, referencing the actual evidence" }
}

Rules:
- British English.
- 3 to 5 action plan items, sequenced so blockers come first.
- timeframe is one of "This week", "This month", "This quarter".
- Use the issue codes exactly as given for "tailored" keys. Cover at most 5.
- No hype, no filler, no "in today's digital landscape". Be concrete and specific.
- Never invent findings that are not in the list above.`;

  try {
    const res = await client.messages.create({
      model: env.anthropicModel(),
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    const json = extractJson(text);
    if (!json) return fallback;

    const parsed = JSON.parse(json) as Partial<Recommendation>;
    const plan = Array.isArray(parsed.actionPlan) ? parsed.actionPlan : [];

    return {
      executiveSummary:
        typeof parsed.executiveSummary === 'string' && parsed.executiveSummary.trim()
          ? parsed.executiveSummary.trim()
          : fallback.executiveSummary,
      actionPlan: plan.length
        ? plan
            .filter((a) => a && typeof a.title === 'string')
            .slice(0, 5)
            .map((a) => ({
              title: String(a.title),
              detail: String(a.detail ?? ''),
              timeframe: String(a.timeframe ?? 'This month'),
            }))
        : fallback.actionPlan,
      tailored:
        parsed.tailored && typeof parsed.tailored === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.tailored)
                .filter(([, v]) => typeof v === 'string' && v.trim())
                .map(([k, v]) => [k, String(v).trim()]),
            )
          : {},
      aiGenerated: true,
    };
  } catch {
    // A recommendation is a nice-to-have on top of a complete mechanical report.
    // It must never fail the audit.
    return fallback;
  }
}

/** Strip a markdown fence if the model added one, then isolate the JSON object. */
function extractJson(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced?.[1]?.trim() ?? text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return body.slice(start, end + 1);
}

/** Deterministic copy derived from the findings — the no-API-key path. */
export function staticRecommendation(
  score: AeoScore,
  issues: Issue[],
  context: { origin: string; brandName: string; pagesCrawled: number },
): Recommendation {
  const critical = issues.filter((i) => i.severity === 'critical');
  const quickWins = issues.filter((i) => i.effort === 'low' && i.severity !== 'critical');
  const host = safeHost(context.origin);

  const summary = critical.length
    ? `${host} scores ${score.overall}/100 for AI-search readiness, held back by ${critical.length} critical ${critical.length === 1 ? 'problem' : 'problems'}. ${critical[0]!.title} is the blocker: until it is fixed, other improvements cannot reach the AI engines. ${quickWins.length} further ${quickWins.length === 1 ? 'fix is' : 'fixes are'} quick wins once it is cleared.`
    : score.overall >= 80
      ? `${host} scores ${score.overall}/100 for AI-search readiness, which is strong. There are no blocking problems. The remaining ${issues.length} ${issues.length === 1 ? 'item' : 'items'} are refinements, led by ${issues[0]?.title.toLowerCase() ?? 'minor cleanup'}.`
      : `${host} scores ${score.overall}/100 for AI-search readiness across ${context.pagesCrawled} ${context.pagesCrawled === 1 ? 'page' : 'pages'}. Nothing is outright blocking the AI crawlers, but ${issues.length} ${issues.length === 1 ? 'issue is' : 'issues are'} limiting how often you get cited. Start with ${issues[0]?.title.toLowerCase() ?? 'the highest-priority item'}.`;

  const plan: Recommendation['actionPlan'] = [];
  for (const issue of critical.slice(0, 2)) {
    plan.push({
      title: issue.title,
      detail: issue.howToFix.split('. ').slice(0, 2).join('. '),
      timeframe: 'This week',
    });
  }
  for (const issue of quickWins.slice(0, 3 - plan.length > 0 ? 3 - plan.length : 1)) {
    plan.push({
      title: issue.title,
      detail: issue.howToFix.split('. ').slice(0, 2).join('. '),
      timeframe: 'This week',
    });
  }
  for (const issue of issues.filter((i) => i.effort !== 'low' && i.severity !== 'critical').slice(0, 2)) {
    plan.push({
      title: issue.title,
      detail: issue.howToFix.split('. ').slice(0, 2).join('. '),
      timeframe: issue.effort === 'high' ? 'This quarter' : 'This month',
    });
  }

  return {
    executiveSummary: summary,
    actionPlan: plan.slice(0, 5),
    tailored: {},
    aiGenerated: false,
  };
}

function safeHost(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** Suggest prompts worth tracking for a site. Falls back to templates without a key. */
export async function suggestPrompts(context: {
  brandName: string;
  origin: string;
  topics: string[];
}): Promise<{ prompts: string[]; aiGenerated: boolean }> {
  const fallback = {
    prompts: [
      `best ${context.topics[0] ?? 'provider'} in the UK`,
      `${context.brandName} reviews`,
      `${context.topics[0] ?? 'service'} vs alternatives`,
      `how do I choose a ${context.topics[0] ?? 'provider'}`,
      `${context.brandName} pricing`,
    ],
    aiGenerated: false,
  };
  if (!anthropicConfigured()) return fallback;

  try {
    const client = new Anthropic({ apiKey: env.anthropicKey() });
    const res = await client.messages.create({
      model: env.anthropicModel(),
      max_tokens: 600,
      messages: [
        {
          role: 'user',
          content: `Brand "${context.brandName}" at ${context.origin}. Topics found on the site: ${context.topics.slice(0, 12).join(', ')}.

List 8 prompts a real buyer would type into ChatGPT or Perplexity where this brand should ideally be cited. Mix commercial intent ("best X for Y"), comparison ("X vs Y"), and problem-led ("how do I ..."). British English.

Return ONLY a JSON array of strings, no fence.`,
        },
      ],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end <= start) return fallback;
    const arr = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!Array.isArray(arr)) return fallback;
    const prompts = arr.filter((x): x is string => typeof x === 'string' && x.trim().length > 3).slice(0, 8);
    return prompts.length ? { prompts, aiGenerated: true } : fallback;
  } catch {
    return fallback;
  }
}
