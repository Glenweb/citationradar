import { z } from 'zod';
import { ALL_ENGINES } from './billing/plans';

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email('Enter a valid email address.');

export const signupSchema = z.object({
  email: emailSchema,
  password: z.string().min(10, 'Password must be at least 10 characters.').max(200),
  name: z.string().trim().max(120).optional(),
  workspaceName: z.string().trim().min(1).max(120).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.').max(200),
});

export const urlInputSchema = z
  .string()
  .trim()
  .min(3, 'Enter a URL.')
  .max(2048)
  .refine((v) => !/\s/.test(v), 'A URL cannot contain spaces.');

export const siteSchema = z.object({
  url: urlInputSchema,
  name: z.string().trim().max(120).optional(),
  brandName: z.string().trim().min(1, 'Enter the brand name to track.').max(120),
  brandAliases: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
});

export const siteUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  brandName: z.string().trim().min(1).max(120).optional(),
  brandAliases: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
});

export const auditSchema = z.object({
  siteId: z.string().uuid('Pick a site to audit.'),
  maxPages: z.number().int().min(1).max(2000).optional(),
});

export const freeAuditSchema = z.object({ url: urlInputSchema });

export const promptSchema = z.object({
  siteId: z.string().uuid(),
  prompt: z.string().trim().min(3, 'A prompt needs at least 3 characters.').max(500),
  intent: z.enum(['informational', 'commercial', 'local', 'navigational']).optional(),
  locale: z.string().trim().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Use a locale like en-GB.').optional(),
  engines: z.array(z.enum(ALL_ENGINES as [string, ...string[]])).min(1).max(4).optional(),
});

export const promptUpdateSchema = z.object({
  prompt: z.string().trim().min(3).max(500).optional(),
  intent: z.enum(['informational', 'commercial', 'local', 'navigational']).nullable().optional(),
  engines: z.array(z.enum(ALL_ENGINES as [string, ...string[]])).min(1).max(4).optional(),
  isActive: z.boolean().optional(),
});

export const competitorSchema = z.object({
  siteId: z.string().uuid(),
  name: z.string().trim().min(1, 'Enter the competitor name.').max(120),
  domain: z.string().trim().max(253).optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
});

export const brandingSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  brandName: z.string().trim().max(120).nullable().optional(),
  brandLogoUrl: z.string().trim().url().max(2048).nullable().optional(),
  brandColour: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #4f46e5.')
    .optional(),
  brandFooter: z.string().trim().max(300).nullable().optional(),
  brandContact: z.string().trim().max(300).nullable().optional(),
});

export const shareLinkSchema = z.object({
  kind: z.enum(['audit', 'citations', 'combined']),
  siteId: z.string().uuid().optional(),
  auditId: z.string().uuid().optional(),
  label: z.string().trim().max(120).optional(),
});

export const checkoutSchema = z.object({ plan: z.enum(['starter', 'growth', 'agency']) });

export const issueStatusSchema = z.object({
  status: z.enum(['open', 'in_progress', 'fixed', 'ignored']),
});

/** Normalise "example.com/page" to an origin + domain pair. */
export function parseSiteUrl(input: string): { origin: string; domain: string } {
  const withScheme = /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
  const url = new URL(withScheme);
  return { origin: url.origin, domain: url.hostname.replace(/^www\./i, '').toLowerCase() };
}
