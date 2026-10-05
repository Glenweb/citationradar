'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { patch } from './client-api';
import { Badge, CodeBlock } from './ui';
import { EFFORT_LABELS, SEVERITY_LABELS, type Effort, type Severity } from '@/lib/aeo/issues';

export type IssueItem = {
  id: string;
  code: string;
  pillar: string;
  severity: Severity;
  effort: Effort;
  title: string;
  what_it_means: string;
  why_it_matters: string;
  how_to_fix: string;
  code_snippet: string | null;
  impact_points: string;
  priority_score: string;
  affected_count: number;
  affected_sample: string[];
  status: string;
  ai_generated?: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  fixed: 'Fixed',
  ignored: 'Ignored',
};

/**
 * The prioritised fix list. Each issue is a work item with a status, so the report
 * doubles as a to-do list the client and developer can work through.
 */
export function IssueList({ auditId, issues }: { auditId: string; issues: IssueItem[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('open');
  const [open, setOpen] = useState<Set<string>>(new Set(issues.slice(0, 2).map((i) => i.id)));
  const [pending, setPending] = useState<string | null>(null);

  const visible = issues.filter((i) => {
    if (filter === 'all') return true;
    if (filter === 'open') return i.status === 'open' || i.status === 'in_progress';
    return i.status === 'fixed' || i.status === 'ignored';
  });

  async function setStatus(issueId: string, status: string) {
    setPending(issueId);
    await patch(`/api/audits/${auditId}/issues/${issueId}`, { status });
    setPending(null);
    router.refresh();
  }

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const counts = {
    open: issues.filter((i) => i.status === 'open' || i.status === 'in_progress').length,
    done: issues.filter((i) => i.status === 'fixed' || i.status === 'ignored').length,
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-ink-200 px-5 py-3">
        {(
          [
            ['open', `Open (${counts.open})`],
            ['done', `Done (${counts.done})`],
            ['all', `All (${issues.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              filter === key
                ? 'bg-ink-900 text-white'
                : 'bg-white text-ink-600 ring-1 ring-inset ring-ink-200 hover:bg-ink-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-ink-500">
          {filter === 'open'
            ? 'Nothing open. Every issue has been marked fixed or ignored.'
            : 'Nothing here yet.'}
        </p>
      ) : (
        <ol className="divide-y divide-ink-100">
          {visible.map((issue, i) => {
            const isOpen = open.has(issue.id);
            const done = issue.status === 'fixed' || issue.status === 'ignored';
            return (
              <li key={issue.id} className={done ? 'bg-ink-50/60' : undefined}>
                <div className="px-5 py-4">
                  <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                    <span className="mt-0.5 w-5 shrink-0 text-sm font-bold text-ink-300">
                      {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggle(issue.id)}
                      aria-expanded={isOpen}
                      className="min-w-0 flex-1 text-left"
                    >
                      <h3
                        className={`text-sm font-semibold ${done ? 'text-ink-500 line-through' : 'text-ink-900'}`}
                      >
                        {issue.title}
                      </h3>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {issue.pillar.replace(/_/g, ' ')}
                        {issue.affected_count > 0 ? ` · ${issue.affected_count} pages affected` : ''}
                        {issue.ai_generated ? ' · tailored by Claude' : ''}
                      </p>
                    </button>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <Badge tone={issue.severity}>{SEVERITY_LABELS[issue.severity]}</Badge>
                      <Badge tone="neutral">{EFFORT_LABELS[issue.effort]}</Badge>
                      <Badge tone="info">+{Number(issue.impact_points).toFixed(1)} pts</Badge>
                    </div>
                  </div>

                  {isOpen ? (
                    <div className="mt-3 space-y-3 pl-8">
                      <p className="whitespace-pre-line text-sm text-ink-700">{issue.what_it_means}</p>
                      <p className="text-sm text-ink-500">
                        <span className="font-medium text-ink-600">Why it matters:</span>{' '}
                        {issue.why_it_matters}
                      </p>
                      <p className="text-sm text-ink-700">
                        <span className="font-medium">How to fix:</span> {issue.how_to_fix}
                      </p>

                      {issue.code_snippet ? <CodeBlock>{issue.code_snippet}</CodeBlock> : null}

                      {issue.affected_sample.length ? (
                        <details className="text-xs">
                          <summary className="cursor-pointer font-medium text-ink-600">
                            Affected pages ({issue.affected_count})
                          </summary>
                          <ul className="mt-1.5 space-y-0.5 text-ink-500">
                            {issue.affected_sample.map((url) => (
                              <li key={url} className="truncate font-mono">
                                {url}
                              </li>
                            ))}
                            {issue.affected_count > issue.affected_sample.length ? (
                              <li className="text-ink-400">
                                …and {issue.affected_count - issue.affected_sample.length} more
                              </li>
                            ) : null}
                          </ul>
                        </details>
                      ) : null}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <span className="text-xs text-ink-400">
                          Status: {STATUS_LABELS[issue.status] ?? issue.status}
                        </span>
                        {(['in_progress', 'fixed', 'ignored', 'open'] as const)
                          .filter((s) => s !== issue.status)
                          .map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setStatus(issue.id, s)}
                              disabled={pending === issue.id}
                              className="rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-ink-700 ring-1 ring-inset ring-ink-200 transition hover:bg-ink-50 disabled:opacity-50"
                            >
                              Mark {STATUS_LABELS[s]?.toLowerCase()}
                            </button>
                          ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
