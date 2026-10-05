import type { EngineId } from '../billing/plans';

export type { EngineId };

export type CompetitorRef = { name: string; domain: string | null; aliases: string[] };

export type CitationQuery = {
  prompt: string;
  brandName: string;
  brandAliases: string[];
  domain: string;
  competitors: CompetitorRef[];
  locale: string;
};

export type CitationUrl = { url: string; title?: string; domain: string; isBrand: boolean };

export type CompetitorMention = {
  name: string;
  mentions: number;
  position: number | null;
  linked: boolean;
};

export type CitationResult = {
  engine: EngineId;
  mode: 'live' | 'simulated';
  brandCited: boolean;
  /** 1-based rank of the brand's first mention among all brands named. */
  brandPosition: number | null;
  brandMentions: number;
  domainLinked: boolean;
  shareOfVoice: number;
  citationUrls: CitationUrl[];
  competitorMentions: CompetitorMention[];
  responseExcerpt: string;
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  latencyMs: number;
  error?: string;
};

export type EngineProvider = {
  id: EngineId;
  label: string;
  isConfigured(): boolean;
  /** Which env vars would enable live mode. Shown in settings. */
  requires: string[];
  check(query: CitationQuery): Promise<CitationResult>;
};
