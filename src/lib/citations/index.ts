import { anthropicProvider } from './anthropic';
import { dataForSeoProvider } from './dataforseo';
import { openaiProvider } from './openai';
import { perplexityProvider } from './perplexity';
import type { CitationQuery, CitationResult, EngineId, EngineProvider } from './types';

export * from './types';
export { analyseResponse, countMentions, domainMatches, domainOf } from './analyse';

export const PROVIDERS: Record<EngineId, EngineProvider> = {
  chatgpt: openaiProvider,
  perplexity: perplexityProvider,
  google_aio: dataForSeoProvider,
  claude: anthropicProvider,
};

export function providerFor(engine: EngineId): EngineProvider {
  return PROVIDERS[engine];
}

/** Which engines are live vs simulated — surfaced in settings and on every chart. */
export function engineStatus(): {
  engine: EngineId;
  label: string;
  configured: boolean;
  requires: string[];
}[] {
  return Object.values(PROVIDERS).map((p) => ({
    engine: p.id,
    label: p.label,
    configured: p.isConfigured(),
    requires: p.requires,
  }));
}

export function anyEngineLive(): boolean {
  return Object.values(PROVIDERS).some((p) => p.isConfigured());
}

/**
 * Run one prompt against several engines concurrently. Each engine resolves
 * independently — one failing provider never loses the others' results.
 */
export async function checkPrompt(
  query: CitationQuery,
  engines: EngineId[],
): Promise<CitationResult[]> {
  return Promise.all(engines.map((engine) => providerFor(engine).check(query)));
}
