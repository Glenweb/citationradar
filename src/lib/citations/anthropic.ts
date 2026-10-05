import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env';
import { analyseResponse, erroredResult } from './analyse';
import { messageOf } from './openai';
import { simulateCheck } from './simulate';
import type { CitationQuery, CitationResult, EngineProvider } from './types';

/**
 * Claude, with the server-side web_search tool so the answer is grounded and returns
 * source URLs rather than recalled training data.
 */
export const anthropicProvider: EngineProvider = {
  id: 'claude',
  label: 'Claude',
  requires: ['ANTHROPIC_API_KEY'],
  isConfigured: () => !!env.anthropicKey(),

  async check(query: CitationQuery): Promise<CitationResult> {
    if (!anthropicProvider.isConfigured()) return simulateCheck('claude', query);
    const started = Date.now();

    try {
      const client = new Anthropic({ apiKey: env.anthropicKey(), timeout: 60_000 });
      const res = await client.messages.create({
        model: env.anthropicModel(),
        max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
        messages: [{ role: 'user', content: query.prompt }],
      });

      const parts: string[] = [];
      const urls: { url: string; title?: string }[] = [];

      for (const block of res.content) {
        if (block.type === 'text') {
          parts.push(block.text);
          // Grounded answers carry web_search_result_location citations per text block.
          const citations = (block as { citations?: unknown[] }).citations ?? [];
          for (const c of citations) {
            const cit = c as { url?: string; title?: string };
            if (cit.url) urls.push({ url: cit.url, title: cit.title });
          }
        } else if (block.type === 'web_search_tool_result') {
          const content = (block as { content?: unknown }).content;
          if (Array.isArray(content)) {
            for (const r of content) {
              const row = r as { url?: string; title?: string };
              if (row.url) urls.push({ url: row.url, title: row.title });
            }
          }
        }
      }

      const text = parts.join('\n\n');
      if (!text.trim()) {
        return erroredResult('claude', 'live', 'Claude returned an empty answer', Date.now() - started);
      }
      return analyseResponse('claude', query, text, urls, 'live', Date.now() - started);
    } catch (e) {
      return erroredResult('claude', 'live', messageOf(e), Date.now() - started);
    }
  },
};
