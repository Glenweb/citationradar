#!/usr/bin/env node
/**
 * Seeds a demo workspace so the app is explorable immediately.
 *
 * Creates a user, workspace, two sites, tracked prompts, competitors, and 12 weeks of
 * back-dated citation history so the charts have something to show. All citation rows are
 * written with mode='simulated' and trigger_source='seed', so demo data is distinguishable
 * from anything measured.
 *
 * Idempotent: re-running updates the demo user's password and tops up history rather than
 * duplicating rows. Pass --fresh to delete the demo user first.
 */
import { createHash, randomBytes, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';
import { exec, close, driver } from './_sql.mjs';

const scrypt = promisify(scryptCb);
const fresh = process.argv.includes('--fresh');

const DEMO = {
  email: 'demo@citationradar.app',
  password: 'demopassword1',
  name: 'Demo User',
  workspace: 'GMK Media (demo)',
};

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$16384$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
}

const SITES = [
  {
    origin: 'https://www.luggagefortravel.com',
    domain: 'luggagefortravel.com',
    name: 'Luggage For Travel',
    brand: 'Luggage For Travel',
    aliases: ['LuggageForTravel', 'LFT'],
    competitors: [
      { name: 'Samsonite', domain: 'samsonite.com' },
      { name: 'Antler', domain: 'antler.co.uk' },
      { name: 'Away', domain: 'awaytravel.com' },
    ],
    prompts: [
      ['best carry-on luggage for 2026', 'commercial'],
      ['hard shell vs soft shell suitcase which is better', 'informational'],
      ['best cabin bag for ryanair size limits', 'commercial'],
      ['most durable suitcase brands uk', 'commercial'],
      ['how do I choose luggage for long haul travel', 'informational'],
    ],
  },
  {
    origin: 'https://www.gmkmedia.co.uk',
    domain: 'gmkmedia.co.uk',
    name: 'GMK Media',
    brand: 'GMK Media',
    aliases: ['GMK'],
    competitors: [
      { name: 'Builtvisible', domain: 'builtvisible.com' },
      { name: 'Impression', domain: 'impression.co.uk' },
    ],
    prompts: [
      ['best aeo agency uk', 'commercial'],
      ['how do I get my brand cited by chatgpt', 'informational'],
      ['ai search optimisation agency london', 'local'],
    ],
  },
];

const ENGINES = ['chatgpt', 'perplexity', 'google_aio', 'claude'];

/** Deterministic pseudo-random in [0,1) from a string — same seed, same demo data. */
function seeded(key) {
  return createHash('sha256').update(key).digest().readUInt32BE(0) / 0xffffffff;
}

async function one(sql, params = []) {
  const rows = await exec(sql, params);
  return rows[0] ?? null;
}

async function run() {
  console.log(`driver: ${driver}`);

  if (fresh) {
    await exec('DELETE FROM users WHERE email_norm = $1', [DEMO.email.toLowerCase()]);
    console.log('· removed the existing demo user');
  }

  // ── user + workspace ──────────────────────────────────────────────────
  let user = await one('SELECT id FROM users WHERE email_norm = $1', [DEMO.email.toLowerCase()]);
  const passwordHash = await hashPassword(DEMO.password);

  if (user) {
    await exec('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, user.id]);
    console.log('· demo user exists, password reset');
  } else {
    user = await one(
      `INSERT INTO users (email, email_norm, name, password_hash)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [DEMO.email, DEMO.email.toLowerCase(), DEMO.name, passwordHash],
    );
    console.log('✓ created the demo user');
  }

  let workspace = await one('SELECT id FROM workspaces WHERE owner_user_id = $1 LIMIT 1', [user.id]);
  if (!workspace) {
    workspace = await one(
      `INSERT INTO workspaces (name, slug, owner_user_id, plan, brand_name, brand_colour,
                               brand_footer, brand_contact)
       VALUES ($1, $2, $3, 'agency', $4, '#0f766e', $5, $6) RETURNING id`,
      [
        DEMO.workspace,
        'gmk-media-demo',
        user.id,
        'GMK Media',
        'GMK Media Ltd — AI search reporting',
        'Questions? hello@gmkmedia.co.uk',
      ],
    );
    await exec(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')
       ON CONFLICT DO NOTHING`,
      [workspace.id, user.id],
    );
    console.log('✓ created the demo workspace on the Agency plan');
  } else {
    // Agency plan so every feature is explorable in the demo.
    await exec("UPDATE workspaces SET plan = 'agency', plan_status = 'active' WHERE id = $1", [
      workspace.id,
    ]);
    console.log('· demo workspace exists, set to the Agency plan');
  }

  // ── sites, prompts, competitors ───────────────────────────────────────
  let promptsCreated = 0;
  let checksCreated = 0;

  for (const spec of SITES) {
    let site = await one('SELECT id FROM sites WHERE workspace_id = $1 AND origin = $2', [
      workspace.id,
      spec.origin,
    ]);
    if (!site) {
      site = await one(
        `INSERT INTO sites (workspace_id, origin, domain, name, brand_name, brand_aliases)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [workspace.id, spec.origin, spec.domain, spec.name, spec.brand, spec.aliases],
      );
      console.log(`✓ site: ${spec.name}`);
    }

    for (const comp of spec.competitors) {
      await exec(
        `INSERT INTO competitors (workspace_id, site_id, name, domain)
         VALUES ($1, $2, $3, $4) ON CONFLICT (site_id, name) DO NOTHING`,
        [workspace.id, site.id, comp.name, comp.domain],
      );
    }

    for (const [text, intent] of spec.prompts) {
      let prompt = await one(
        'SELECT id FROM tracked_prompts WHERE site_id = $1 AND prompt = $2 AND locale = $3',
        [site.id, text, 'en-GB'],
      );
      if (!prompt) {
        prompt = await one(
          `INSERT INTO tracked_prompts (workspace_id, site_id, prompt, intent, locale, engines)
           VALUES ($1, $2, $3, $4, 'en-GB', $5) RETURNING id`,
          [workspace.id, site.id, text, intent, ENGINES],
        );
        promptsCreated += 1;
      }

      const existing = await one(
        'SELECT count(*)::int AS n FROM citation_checks WHERE prompt_id = $1',
        [prompt.id],
      );
      if (Number(existing?.n ?? 0) > 0) continue;

      // 12 weeks of history, trending upward, so the chart tells a story.
      for (let week = 11; week >= 0; week -= 1) {
        const checkedAt = new Date(Date.now() - week * 7 * 86_400_000).toISOString();
        const progress = (11 - week) / 11; // 0 → 1 over the period

        for (const engine of ENGINES) {
          const r = seeded(`${prompt.id}|${engine}|${week}`);
          const baseRate = { chatgpt: 0.45, perplexity: 0.6, google_aio: 0.3, claude: 0.4 }[engine];
          const cited = r < baseRate + progress * 0.3;

          const brandMentions = cited ? (r < 0.3 ? 2 : 1) : 0;
          const competitorMentions = spec.competitors.map((c, i) => {
            const cr = seeded(`${prompt.id}|${engine}|${week}|${c.name}`);
            const mentions = cr < 0.7 - i * 0.15 ? (cr < 0.25 ? 2 : 1) : 0;
            return {
              name: c.name,
              mentions,
              position: mentions ? i + (cited ? 2 : 1) : null,
              linked: mentions > 0 && cr < 0.4,
            };
          });

          const compTotal = competitorMentions.reduce((s, c) => s + c.mentions, 0);
          const total = brandMentions + compTotal;
          const sov = total > 0 ? Number((brandMentions / total).toFixed(4)) : 0;

          const citationUrls = [];
          if (cited) {
            citationUrls.push({
              url: `https://${spec.domain}/`,
              title: spec.name,
              domain: spec.domain,
              isBrand: true,
            });
          }
          for (const c of spec.competitors) {
            const cm = competitorMentions.find((x) => x.name === c.name);
            if (cm?.linked) {
              citationUrls.push({ url: `https://${c.domain}/`, title: c.name, domain: c.domain, isBrand: false });
            }
          }

          await exec(
            `INSERT INTO citation_checks (
               workspace_id, site_id, prompt_id, engine, mode, brand_cited, brand_position,
               brand_mentions, domain_linked, share_of_voice, citation_urls,
               competitor_mentions, response_excerpt, sentiment, latency_ms,
               trigger_source, checked_at
             ) VALUES ($1,$2,$3,$4,'simulated',$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,'seed',$15)`,
            [
              workspace.id,
              site.id,
              prompt.id,
              engine,
              cited,
              cited ? 1 : null,
              brandMentions,
              cited && citationUrls.some((u) => u.isBrand),
              sov,
              JSON.stringify(citationUrls),
              JSON.stringify(competitorMentions),
              cited
                ? `${spec.brand} is among the options most often recommended for "${text}". ${competitorMentions.filter((c) => c.mentions).map((c) => c.name).join(' and ') || 'Other providers'} also appear.`
                : `For "${text}", the answer names ${competitorMentions.filter((c) => c.mentions).map((c) => c.name).join(' and ') || 'other providers'} but not ${spec.brand}.`,
              cited ? (seeded(`s|${prompt.id}|${engine}|${week}`) < 0.6 ? 'positive' : 'neutral') : null,
              Math.round(500 + seeded(`l|${prompt.id}|${engine}|${week}`) * 2500),
              checkedAt,
            ],
          );
          checksCreated += 1;
        }
      }

      await exec('UPDATE tracked_prompts SET last_checked_at = now() WHERE id = $1', [prompt.id]);
    }
  }

  console.log(`\n✓ seeded ${promptsCreated} prompt(s) and ${checksCreated} citation check(s)`);
  console.log('\nSign in at http://localhost:3000/login');
  console.log(`  email:    ${DEMO.email}`);
  console.log(`  password: ${DEMO.password}`);
  console.log('\nAll seeded citation data is marked mode=simulated / trigger_source=seed.');
  console.log('Run a real audit from a site page — crawling needs no API key.');

  await close();
}

run().catch(async (e) => {
  console.error(e);
  await close().catch(() => {});
  process.exit(1);
});
