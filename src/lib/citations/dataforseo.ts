import { env } from '../env';
import { analyseResponse, erroredResult } from './analyse';
import { messageOf } from './openai';
import { simulateCheck } from './simulate';
import type { CitationQuery, CitationResult, EngineProvider } from './types';

/**
 * Google AI Overviews, via DataForSEO's SERP Advanced endpoint.
 *
 * There is no Google API for AI Overviews, so a SERP provider is the only practical
 * route. We request the live advanced endpoint and pull the `ai_overview` item out of
 * the result, flattening its references into citation URLs.
 */
export const dataForSeoProvider: EngineProvider = {
  id: 'google_aio',
  label: 'Google AI Overviews',
  requires: ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'],
  isConfigured: () => !!env.dataForSeoLogin() && !!env.dataForSeoPassword(),

  async check(query: CitationQuery): Promise<CitationResult> {
    if (!dataForSeoProvider.isConfigured()) return simulateCheck('google_aio', query);
    const started = Date.now();

    const auth = Buffer.from(`${env.dataForSeoLogin()}:${env.dataForSeoPassword()}`).toString('base64');
    const [lang, country] = splitLocale(query.locale);

    try {
      const res = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([
          {
            keyword: query.prompt,
            language_code: lang,
            location_code: locationCode(country),
            device: 'desktop',
            os: 'windows',
            load_async_ai_overview: true,
            people_also_ask_click_depth: 0,
          },
        ]),
        signal: AbortSignal.timeout(90_000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return erroredResult(
          'google_aio',
          'live',
          `DataForSEO returned ${res.status}: ${body.slice(0, 200)}`,
          Date.now() - started,
        );
      }

      const data = (await res.json()) as DfsResponse;
      const task = data.tasks?.[0];
      if (task?.status_code && task.status_code >= 40000) {
        return erroredResult(
          'google_aio',
          'live',
          `DataForSEO task error ${task.status_code}: ${task.status_message ?? ''}`,
          Date.now() - started,
        );
      }

      const items = task?.result?.[0]?.items ?? [];
      const aio = items.find((i) => i.type === 'ai_overview');

      if (!aio) {
        // No AI Overview for this query is a real, reportable finding: the brand cannot
        // be cited in a block Google did not render.
        return {
          ...erroredResult('google_aio', 'live', '', Date.now() - started),
          responseExcerpt: 'Google did not return an AI Overview for this query.',
          error: undefined,
        };
      }

      const { text, urls } = flattenAiOverview(aio);
      if (!text.trim() && !urls.length) {
        return erroredResult(
          'google_aio',
          'live',
          'AI Overview present but carried no readable content',
          Date.now() - started,
        );
      }
      return analyseResponse('google_aio', query, text, urls, 'live', Date.now() - started);
    } catch (e) {
      return erroredResult('google_aio', 'live', messageOf(e), Date.now() - started);
    }
  },
};

type DfsReference = { url?: string; title?: string; source?: string; domain?: string };
type DfsAioItem = {
  type?: string;
  text?: string;
  title?: string;
  references?: DfsReference[];
  items?: DfsAioItem[];
};
type DfsResponse = {
  tasks?: {
    status_code?: number;
    status_message?: string;
    result?: { items?: DfsAioItem[] }[];
  }[];
};

/** AI Overview content is a nested tree of text blocks each carrying its own references. */
function flattenAiOverview(root: DfsAioItem): {
  text: string;
  urls: { url: string; title?: string }[];
} {
  const parts: string[] = [];
  const urls: { url: string; title?: string }[] = [];

  const walk = (node: DfsAioItem, depth = 0): void => {
    if (depth > 8 || !node) return;
    if (node.title?.trim()) parts.push(node.title.trim());
    if (node.text?.trim()) parts.push(node.text.trim());
    for (const ref of node.references ?? []) {
      if (ref.url) urls.push({ url: ref.url, title: ref.title ?? ref.source });
    }
    for (const child of node.items ?? []) walk(child, depth + 1);
  };

  walk(root);
  return { text: parts.join('\n'), urls };
}

function splitLocale(locale: string): [string, string] {
  const [lang = 'en', country = 'GB'] = locale.split('-');
  return [lang.toLowerCase(), country.toUpperCase()];
}

/** DataForSEO location codes for the markets we support out of the box. */
const LOCATION_CODES: Record<string, number> = {
  GB: 2826,
  US: 2840,
  CA: 2124,
  AU: 2036,
  IE: 2372,
  NZ: 2554,
  DE: 2276,
  FR: 2250,
  ES: 2724,
  NL: 2528,
};

function locationCode(country: string): number {
  return LOCATION_CODES[country] ?? LOCATION_CODES.GB!;
}
