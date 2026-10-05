import { env } from '../env';
import { analyseResponse, erroredResult } from './analyse';
import { messageOf } from './openai';
import { simulateCheck } from './simulate';
import type { CitationQuery, CitationResult, EngineProvider } from './types';

/**
 * Perplexity via its OpenAI-compatible chat completions endpoint. Perplexity returns a
 * `citations` (newer: `search_results`) array, which is the cleanest citation signal of
 * any engine — every answer is sourced.
 */
export const perplexityProvider: EngineProvider = {
  id: 'perplexity',
  label: 'Perplexity',
  requires: ['PERPLEXITY_API_KEY'],
  isConfigured: () => !!env.perplexityKey(),

  async check(query: CitationQuery): Promise<CitationResult> {
    if (!perplexityProvider.isConfigured()) return simulateCheck('perplexity', query);
    const started = Date.now();

    try {
      const res = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.perplexityKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: env.perplexityModel(),
          messages: [{ role: 'user', content: query.prompt }],
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return erroredResult(
          'perplexity',
          'live',
          `Perplexity returned ${res.status}: ${body.slice(0, 200)}`,
          Date.now() - started,
        );
      }

      const data = (await res.json()) as PerplexityResponse;
      const text = data.choices?.[0]?.message?.content ?? '';
      if (!text.trim()) {
        return erroredResult('perplexity', 'live', 'Perplexity returned an empty answer', Date.now() - started);
      }

      const urls: { url: string; title?: string }[] = [];
      for (const c of data.citations ?? []) {
        if (typeof c === 'string') urls.push({ url: c });
      }
      for (const r of data.search_results ?? []) {
        if (r?.url) urls.push({ url: r.url, title: r.title });
      }

      return analyseResponse('perplexity', query, text, urls, 'live', Date.now() - started);
    } catch (e) {
      return erroredResult('perplexity', 'live', messageOf(e), Date.now() - started);
    }
  },
};

type PerplexityResponse = {
  choices?: { message?: { content?: string } }[];
  citations?: string[];
  search_results?: { url?: string; title?: string }[];
};
