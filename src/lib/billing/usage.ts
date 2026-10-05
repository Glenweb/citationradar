import 'server-only';
import { sql, sqlOne } from '../db';
import { planOf, type PlanId } from './plans';

export type Metric = 'audits' | 'citation_checks';

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

export async function getUsage(workspaceId: string, metric: Metric): Promise<number> {
  const row = await sqlOne<{ count: number }>`
    SELECT count FROM usage_counters
    WHERE workspace_id = ${workspaceId} AND period = ${currentPeriod()} AND metric = ${metric}
  `;
  return Number(row?.count ?? 0);
}

export async function incrementUsage(
  workspaceId: string,
  metric: Metric,
  by = 1,
): Promise<void> {
  await sql`
    INSERT INTO usage_counters (workspace_id, period, metric, count)
    VALUES (${workspaceId}, ${currentPeriod()}, ${metric}, ${by})
    ON CONFLICT (workspace_id, period, metric)
    DO UPDATE SET count = usage_counters.count + ${by}
  `;
}

/** Raised when an action would exceed the workspace's plan. API routes map it to 402. */
export class PlanLimitError extends Error {
  constructor(
    message: string,
    readonly limit: number,
    readonly used: number,
    readonly upgradeTo: PlanId | null,
  ) {
    super(message);
    this.name = 'PlanLimitError';
  }
}

function nextPlanAbove(plan: PlanId): PlanId | null {
  const order: PlanId[] = ['free', 'starter', 'growth', 'agency'];
  const i = order.indexOf(plan);
  return i >= 0 && i < order.length - 1 ? order[i + 1]! : null;
}

export async function assertAuditQuota(workspaceId: string, plan: PlanId): Promise<void> {
  const limit = planOf(plan).auditsPerMonth;
  if (!Number.isFinite(limit)) return;
  const used = await getUsage(workspaceId, 'audits');
  if (used >= limit) {
    throw new PlanLimitError(
      `Your ${planOf(plan).name} plan includes ${limit} audits per month and you have used ${used}.`,
      limit,
      used,
      nextPlanAbove(plan),
    );
  }
}

export async function assertSiteQuota(workspaceId: string, plan: PlanId): Promise<void> {
  const limit = planOf(plan).sites;
  const row = await sqlOne<{ n: number }>`
    SELECT count(*)::int AS n FROM sites WHERE workspace_id = ${workspaceId}
  `;
  const used = Number(row?.n ?? 0);
  if (used >= limit) {
    throw new PlanLimitError(
      `Your ${planOf(plan).name} plan includes ${limit} site${limit === 1 ? '' : 's'}.`,
      limit,
      used,
      nextPlanAbove(plan),
    );
  }
}

export async function assertPromptQuota(workspaceId: string, plan: PlanId): Promise<void> {
  const limit = planOf(plan).prompts;
  const row = await sqlOne<{ n: number }>`
    SELECT count(*)::int AS n FROM tracked_prompts WHERE workspace_id = ${workspaceId}
  `;
  const used = Number(row?.n ?? 0);
  if (used >= limit) {
    throw new PlanLimitError(
      `Your ${planOf(plan).name} plan includes ${limit} tracked prompts.`,
      limit,
      used,
      nextPlanAbove(plan),
    );
  }
}

export async function assertCompetitorQuota(
  siteId: string,
  plan: PlanId,
): Promise<void> {
  const limit = planOf(plan).competitorsPerSite;
  const row = await sqlOne<{ n: number }>`
    SELECT count(*)::int AS n FROM competitors WHERE site_id = ${siteId}
  `;
  const used = Number(row?.n ?? 0);
  if (used >= limit) {
    throw new PlanLimitError(
      `Your ${planOf(plan).name} plan includes ${limit} competitor${limit === 1 ? '' : 's'} per site.`,
      limit,
      used,
      nextPlanAbove(plan),
    );
  }
}
