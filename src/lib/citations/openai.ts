import { env } from '../env';
import { analyseResponse, erroredResult } from './analyse';
import { simulateCheck } from './simulate';
import type { CitationQuery, CitationResult, EngineProvider } from './types';

/**
 * ChatGPT, via the Responses API with the web_search tool so the answer is grounded and
 * carries URL citations — which is what we need to detect a brand link, not just a
 * brand name in training data.
 */
export const openaiProvider: EngineProvider = {
  id: 'chatgpt',
  label: 'ChatGPT',
  requires: ['OPENAI_API_KEY'],
  isConfigured: () => !!env.openaiKey(),

  async check(query: CitationQuery): Promise<CitationResult> {
    if (!openaiProvider.isConfigured()) return simulateCheck('chatgpt', query);
    const started = Date.now();

    try {
      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.openaiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: env.openaiModel(),
          tools: [{ type: 'web_search' }],
          input: query.prompt,
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return erroredResult(
          'chatgpt',
          'live',
          `OpenAI returned ${res.status}: ${body.slice(0, 200)}`,
          Date.now() - started,
        );
      }

      const data = (await res.json()) as OpenAiResponse;
      const { text, urls } = flattenResponse(data);
      if (!text.trim()) {
        return erroredResult('chatgpt', 'live', 'OpenAI returned an empty answer', Date.now() - started);
      }
      return analyseResponse('chatgpt', query, text, urls, 'live', Date.now() - started);
    } catch (e) {
      return erroredResult('chatgpt', 'live', messageOf(e), Date.now() - started);
    }
  },
};

type OpenAiAnnotation = { type?: string; url?: string; title?: string };
type OpenAiContent = { type?: string; text?: string; annotations?: OpenAiAnnotation[] };
type OpenAiOutput = { type?: string; content?: OpenAiContent[] };
type OpenAiResponse = { output_text?: string; output?: OpenAiOutput[] };

/** The Responses API nests text and url_citation annotations inside output items. */
function flattenResponse(data: OpenAiResponse): {
  text: string;
  urls: { url: string; title?: string }[];
} {
  const parts: string[] = [];
  const urls: { url: string; title?: string }[] = [];

  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    parts.push(data.output_text);
  }

  for (const item of data.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === 'string' && content.text.trim()) {
        if (!parts.includes(content.text)) parts.push(content.text);
      }
      for (const a of content.annotations ?? []) {
        if (a.url) urls.push({ url: a.url, title: a.title });
      }
    }
  }
  return { text: parts.join('\n\n'), urls };
}

export function messageOf(e: unknown): string {
  if (e instanceof Error) {
    return e.name === 'TimeoutError' || e.name === 'AbortError' ? 'Request timed out' : e.message;
  }
  return String(e);
}
