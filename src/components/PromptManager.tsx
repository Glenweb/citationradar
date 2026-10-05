'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { del, patch, post } from './client-api';
import { ENGINE_LABELS, type EngineId } from '@/lib/billing/plans';

export type PromptItem = {
  id: string;
  prompt: string;
  intent: string | null;
  engines: string[];
  is_active: boolean;
  last_checked_at: string | null;
};

export type LatestResult = {
  prompt_id: string;
  engine: EngineId;
  brand_cited: boolean;
  brand_position: number | null;
  share_of_voice: string;
  mode: string;
  response_excerpt: string | null;
  citation_urls: { url: string; isBrand: boolean }[] | unknown;
  error: string | null;
  checked_at: string;
};

export function PromptManager({
  siteId,
  prompts,
  results,
  allowedEngines,
  promptLimit,
  promptCount,
}: {
  siteId: string;
  prompts: PromptItem[];
  results: LatestResult[];
  allowedEngines: EngineId[];
  promptLimit: number;
  promptCount: number;
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [intent, setIntent] = useState('commercial');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const atLimit = promptCount >= promptLimit;

  async function addPrompt(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!text.trim()) return;
    setBusy(true);
    const res = await post('/api/prompts', {
      siteId,
      prompt: text.trim(),
      intent,
      engines: allowedEngines,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setText('');
    router.refresh();
  }

  async function check(promptId: string) {
    setChecking(promptId);
    setError(null);
    const res = await post(`/api/prompts/${promptId}/check`);
    setChecking(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  async function checkAll() {
    setChecking('all');
    setError(null);
    for (const p of prompts.filter((x) => x.is_active)) {
      const res = await post(`/api/prompts/${p.id}/check`);
      if (!res.ok) {
        setError(res.error);
        break;
      }
    }
    setChecking(null);
    router.refresh();
  }

  async function toggleActive(prompt: PromptItem) {
    const res = await patch(`/api/prompts/${prompt.id}`, { isActive: !prompt.is_active });
    if (!res.ok) setError(res.error);
    router.refresh();
  }

  async function remove(promptId: string) {
    const res = await del(`/api/prompts/${promptId}`);
    if (!res.ok) setError(res.error);
    router.refresh();
  }

  return (
    <div>
      <form onSubmit={addPrompt} className="border-b border-ink-200 p-5">
        <label htmlFor="new-prompt" className="block text-sm font-medium text-ink-700">
          Add a prompt to track
        </label>
        <p className="mt-0.5 text-xs text-ink-500">
          Write it exactly as a buyer would type it into ChatGPT.
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id="new-prompt"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="best accountant for contractors in london"
            disabled={busy || atLimit}
            className="min-w-0 flex-1 rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-ink-50"
          />
          <select
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            disabled={busy || atLimit}
            aria-label="Prompt intent"
            className="rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none disabled:bg-ink-50"
          >
            <option value="commercial">Commercial</option>
            <option value="informational">Informational</option>
            <option value="local">Local</option>
            <option value="navigational">Navigational</option>
          </select>
          <button
            type="submit"
            disabled={busy || atLimit}
            className="shrink-0 rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink-800 disabled:bg-ink-400"
          >
            {busy ? 'Adding…' : 'Add prompt'}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-ink-500">
            {promptCount} of {promptLimit} prompts used · tracking{' '}
            {allowedEngines.map((e) => ENGINE_LABELS[e]).join(', ')}
          </p>
          {prompts.some((p) => p.is_active) ? (
            <button
              type="button"
              onClick={checkAll}
              disabled={checking !== null}
              className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-ink-800 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50 disabled:opacity-60"
            >
              {checking === 'all' ? 'Checking all prompts…' : 'Check all now'}
            </button>
          ) : null}
        </div>
        {atLimit ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            You have used all {promptLimit} prompts on your plan. Upgrade to track more.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 text-sm font-medium text-red-600">
            {error}
          </p>
        ) : null}
      </form>

      {prompts.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-ink-500">
          No prompts yet. Add the questions your buyers actually ask.
        </p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {prompts.map((prompt) => {
            const own = results.filter((r) => r.prompt_id === prompt.id);
            const cited = own.filter((r) => r.brand_cited).length;
            const isOpen = expanded === prompt.id;

            return (
              <li key={prompt.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${prompt.is_active ? 'text-ink-900' : 'text-ink-400 line-through'}`}>
                      {prompt.prompt}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {prompt.intent ?? 'no intent set'}
                      {own.length > 0 ? ` · cited by ${cited} of ${own.length} engines` : ' · not checked yet'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => check(prompt.id)}
                      disabled={checking !== null}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-700 transition hover:bg-brand-50 disabled:opacity-50"
                    >
                      {checking === prompt.id ? 'Checking…' : 'Check now'}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleActive(prompt)}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-500 transition hover:bg-ink-100"
                    >
                      {prompt.is_active ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(prompt.id)}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {own.length > 0 ? (
                  <>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {own.map((r) => (
                        <span
                          key={`${r.prompt_id}-${r.engine}`}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${
                            r.error
                              ? 'bg-ink-50 text-ink-500 ring-ink-200'
                              : r.brand_cited
                                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                                : 'bg-ink-50 text-ink-500 ring-ink-200'
                          }`}
                          title={r.error ?? undefined}
                        >
                          {ENGINE_LABELS[r.engine]}
                          {r.error ? (
                            <span>error</span>
                          ) : r.brand_cited ? (
                            <span>
                              #{r.brand_position ?? '?'} · {Math.round(Number(r.share_of_voice) * 100)}%
                            </span>
                          ) : (
                            <span>not cited</span>
                          )}
                          {r.mode === 'simulated' ? (
                            <span className="font-bold text-amber-600">sim</span>
                          ) : null}
                        </span>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : prompt.id)}
                      className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700"
                      aria-expanded={isOpen}
                    >
                      {isOpen ? 'Hide what the engines said' : 'Show what the engines said'}
                    </button>

                    {isOpen ? (
                      <div className="mt-2 space-y-2">
                        {own.map((r) => (
                          <div
                            key={`x-${r.prompt_id}-${r.engine}`}
                            className="rounded-lg border border-ink-200 bg-ink-50 p-3"
                          >
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                              {ENGINE_LABELS[r.engine]}
                              {r.mode === 'simulated' ? ' · simulated' : ''}
                            </p>
                            {r.error ? (
                              <p className="mt-1 text-xs text-red-600">{r.error}</p>
                            ) : (
                              <>
                                <p className="mt-1 text-xs leading-relaxed text-ink-700">
                                  {r.response_excerpt || 'No excerpt recorded.'}
                                </p>
                                <CitationList urls={r.citation_urls} />
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CitationList({ urls }: { urls: unknown }) {
  if (!Array.isArray(urls) || urls.length === 0) return null;
  const list = urls as { url: string; isBrand?: boolean }[];
  return (
    <ul className="mt-2 space-y-0.5">
      {list.slice(0, 6).map((u) => (
        <li key={u.url} className="truncate text-[11px]">
          <a
            href={u.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={u.isBrand ? 'font-semibold text-brand-700 hover:underline' : 'text-ink-500 hover:underline'}
          >
            {u.url}
          </a>
          {u.isBrand ? <span className="ml-1 text-[10px] text-brand-600">your domain</span> : null}
        </li>
      ))}
    </ul>
  );
}
