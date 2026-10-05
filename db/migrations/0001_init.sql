-- Citation Radar — initial schema
-- Tenancy boundary is `workspaces`. Every descendant row carries workspace_id so that
-- authorisation is a single predicate rather than a join chain.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────────────────────── identity ─────────────────────────────

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  email_norm    text NOT NULL UNIQUE,
  name          text,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx    ON sessions(user_id);
CREATE INDEX sessions_expires_idx ON sessions(expires_at);

-- ──────────────────────────── workspaces ────────────────────────────

CREATE TABLE workspaces (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL,
  slug                   text NOT NULL UNIQUE,
  owner_user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan                   text NOT NULL DEFAULT 'free'
                           CHECK (plan IN ('free','starter','growth','agency')),
  plan_status            text NOT NULL DEFAULT 'active'
                           CHECK (plan_status IN ('active','past_due','canceled','trialing')),
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     timestamptz,
  -- white-label branding
  brand_name             text,
  brand_logo_url         text,
  brand_colour           text NOT NULL DEFAULT '#4f46e5',
  brand_footer           text,
  brand_contact          text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspaces_owner_idx    ON workspaces(owner_user_id);
CREATE INDEX workspaces_customer_idx ON workspaces(stripe_customer_id);

CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_idx ON workspace_members(user_id);

-- ─────────────────────────────── sites ──────────────────────────────

CREATE TABLE sites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  origin       text NOT NULL,              -- https://example.com (scheme + host, no path)
  domain       text NOT NULL,              -- example.com
  name         text NOT NULL,
  brand_name   text NOT NULL,              -- what we look for in AI answers
  brand_aliases text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, origin)
);
CREATE INDEX sites_workspace_idx ON sites(workspace_id);

-- ─────────────────────────────── audits ─────────────────────────────

CREATE TABLE audits (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid REFERENCES workspaces(id) ON DELETE CASCADE, -- NULL for anonymous free audits
  site_id        uuid REFERENCES sites(id) ON DELETE CASCADE,      -- NULL for anonymous free audits
  public_id      text NOT NULL UNIQUE,      -- short id used in free-audit URLs
  scope          text NOT NULL DEFAULT 'site' CHECK (scope IN ('site','single_url')),
  target_url     text NOT NULL,
  origin         text NOT NULL,
  status         text NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued','running','complete','failed')),
  overall_score  integer CHECK (overall_score BETWEEN 0 AND 100),
  previous_score integer CHECK (previous_score BETWEEN 0 AND 100),
  grade          text,
  pillar_scores  jsonb NOT NULL DEFAULT '{}'::jsonb,
  robots         jsonb NOT NULL DEFAULT '{}'::jsonb,
  answer_surface jsonb NOT NULL DEFAULT '{}'::jsonb,
  pages_crawled  integer NOT NULL DEFAULT 0,
  pages_capped   boolean NOT NULL DEFAULT false,
  summary        text,
  error          text,
  created_ip     text,                      -- rate limiting for anonymous audits
  started_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  duration_ms    integer
);
CREATE INDEX audits_site_idx      ON audits(site_id, started_at DESC);
CREATE INDEX audits_workspace_idx ON audits(workspace_id, started_at DESC);
CREATE INDEX audits_ip_idx        ON audits(created_ip, started_at DESC);

CREATE TABLE audit_pages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id       uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  url            text NOT NULL,
  depth          integer NOT NULL DEFAULT 0,
  status_code    integer,
  content_type   text,
  title          text,
  meta_description text,
  h1             text,
  h1_count       integer NOT NULL DEFAULT 0,
  heading_outline jsonb NOT NULL DEFAULT '[]'::jsonb,
  heading_skips  integer NOT NULL DEFAULT 0,
  word_count     integer NOT NULL DEFAULT 0,
  text_ratio     numeric(5,4) NOT NULL DEFAULT 0, -- visible text bytes / html bytes
  js_dependent   boolean NOT NULL DEFAULT false,  -- content only appears after hydration
  jsonld_blocks  integer NOT NULL DEFAULT 0,
  jsonld_invalid integer NOT NULL DEFAULT 0,
  jsonld_types   text[] NOT NULL DEFAULT '{}',
  has_faq        boolean NOT NULL DEFAULT false,
  question_headings integer NOT NULL DEFAULT 0,
  list_count     integer NOT NULL DEFAULT 0,
  table_count    integer NOT NULL DEFAULT 0,
  same_as        text[] NOT NULL DEFAULT '{}',
  date_modified  text,
  author         text,
  issues         text[] NOT NULL DEFAULT '{}',   -- check codes failed on this page
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_id, url)
);
CREATE INDEX audit_pages_audit_idx ON audit_pages(audit_id);

CREATE TABLE audit_issues (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id        uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  workspace_id    uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  code            text NOT NULL,             -- e.g. 'robots.gptbot_blocked'
  pillar          text NOT NULL,
  severity        text NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  effort          text NOT NULL CHECK (effort IN ('low','medium','high')),
  title           text NOT NULL,
  what_it_means   text NOT NULL,             -- plain English, client-safe
  why_it_matters  text NOT NULL,
  how_to_fix      text NOT NULL,
  code_snippet    text,
  impact_points   numeric(5,2) NOT NULL DEFAULT 0,  -- score points recoverable
  priority_score  numeric(6,2) NOT NULL DEFAULT 0,  -- impact ÷ effort
  affected_count  integer NOT NULL DEFAULT 0,
  affected_sample text[] NOT NULL DEFAULT '{}',
  evidence        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_generated    boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','in_progress','fixed','ignored')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_issues_audit_idx    ON audit_issues(audit_id, priority_score DESC);
CREATE INDEX audit_issues_workspace_idx ON audit_issues(workspace_id);

-- ──────────────────── prompts, citations, competitors ───────────────

CREATE TABLE tracked_prompts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  site_id      uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  prompt       text NOT NULL,
  intent       text CHECK (intent IN ('informational','commercial','local','navigational')),
  locale       text NOT NULL DEFAULT 'en-GB',
  engines      text[] NOT NULL DEFAULT '{chatgpt,perplexity,google_aio}',
  is_active    boolean NOT NULL DEFAULT true,
  last_checked_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, prompt, locale)
);
CREATE INDEX tracked_prompts_site_idx   ON tracked_prompts(site_id);
CREATE INDEX tracked_prompts_active_idx ON tracked_prompts(is_active, last_checked_at);

CREATE TABLE competitors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  site_id      uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name         text NOT NULL,
  domain       text,
  aliases      text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, name)
);
CREATE INDEX competitors_site_idx ON competitors(site_id);

-- Append-only. One row per (prompt, engine, run).
CREATE TABLE citation_checks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  site_id         uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  prompt_id       uuid NOT NULL REFERENCES tracked_prompts(id) ON DELETE CASCADE,
  engine          text NOT NULL CHECK (engine IN ('chatgpt','perplexity','google_aio','claude')),
  mode            text NOT NULL CHECK (mode IN ('live','simulated')),
  brand_cited     boolean NOT NULL DEFAULT false,
  brand_position  integer,                   -- 1-based order of first brand mention
  brand_mentions  integer NOT NULL DEFAULT 0,
  domain_linked   boolean NOT NULL DEFAULT false,
  share_of_voice  numeric(5,4) NOT NULL DEFAULT 0,
  citation_urls   jsonb NOT NULL DEFAULT '[]'::jsonb,
  competitor_mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
  response_excerpt text,
  sentiment       text CHECK (sentiment IN ('positive','neutral','negative')),
  latency_ms      integer,
  error           text,
  trigger_source  text NOT NULL DEFAULT 'manual'
                    CHECK (trigger_source IN ('manual','schedule','seed')),
  checked_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX citation_checks_prompt_idx ON citation_checks(prompt_id, checked_at DESC);
CREATE INDEX citation_checks_site_idx   ON citation_checks(site_id, checked_at DESC);
CREATE INDEX citation_checks_engine_idx ON citation_checks(site_id, engine, checked_at DESC);

-- ─────────────────── reports, share links, billing ──────────────────

CREATE TABLE share_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  site_id      uuid REFERENCES sites(id) ON DELETE CASCADE,
  audit_id     uuid REFERENCES audits(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('audit','citations','combined')),
  token        text NOT NULL UNIQUE,
  label        text,
  revoked_at   timestamptz,
  view_count   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz
);
CREATE INDEX share_links_workspace_idx ON share_links(workspace_id);

CREATE TABLE usage_counters (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  period       text NOT NULL,               -- 'YYYY-MM'
  metric       text NOT NULL,               -- 'audits' | 'citation_checks'
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, period, metric)
);

CREATE TABLE scheduled_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('weekly_citations','weekly_audit')),
  status        text NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running','complete','failed','skipped')),
  prompts_run   integer NOT NULL DEFAULT 0,
  checks_written integer NOT NULL DEFAULT 0,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  error         text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX scheduled_runs_ws_idx ON scheduled_runs(workspace_id, started_at DESC);

CREATE TABLE stripe_events (
  id          text PRIMARY KEY,             -- Stripe event id; gives us idempotency
  type        text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
