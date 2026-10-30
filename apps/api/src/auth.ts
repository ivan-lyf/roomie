import type { Refusal } from '@roomie/schema';
import type { Context, MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, errors, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { z } from 'zod';

// Who's signed in (PLAN.md M6). Sign-in happens in the browser with Supabase Auth; the routes
// that call an LLM take its access token, which the API checks itself against the project's
// public signing keys, with no call to Supabase per request.

/** A Supabase user: who spends the LLM calls a request makes. */
export type Account = { id: string; email: string | null };

/** Everyone, when sign-in is off for local development. */
export const LOCAL_ACCOUNT: Account = { id: '00000000-0000-0000-0000-000000000000', email: null };

/** The account an access token belongs to, or undefined when the token doesn't check out. */
export type TokenVerifier = (token: string) => Promise<Account | undefined>;

/** How the routes that call an LLM know who's asking. */
export type Auth = { kind: 'verify'; verify: TokenVerifier } | { kind: 'off' };

const Claims = z.object({
  sub: z.uuid(),
  email: z.string().optional(),
  /** Anonymous sign-ins would give anyone a fresh allowance at will. */
  is_anonymous: z.boolean().optional(),
});

/** Where a Supabase project publishes the public keys its tokens are signed with. */
export const jwksUrl = (projectUrl: string) =>
  new URL(`${projectUrl}/auth/v1/.well-known/jwks.json`);

/**
 * Checks Supabase access tokens: signed by one of the project's keys (fetched once and cached,
 * then again when a token names a key not seen yet), issued by its Auth server for a signed-in
 * user, and not expired.
 */
export function supabaseVerifier(
  projectUrl: string,
  keys: JWTVerifyGetKey = createRemoteJWKSet(jwksUrl(projectUrl)),
): TokenVerifier {
  const issuer = `${projectUrl}/auth/v1`;
  return async (token) => {
    let payload: unknown;
    try {
      ({ payload } = await jwtVerify(token, keys, { issuer, audience: 'authenticated' }));
    } catch (e) {
      // A token that's wrong is refused; keys that can't be fetched are the server's problem.
      if (e instanceof errors.JOSEError && !(e instanceof errors.JWKSTimeout)) return undefined;
      throw e;
    }
    const claims = Claims.safeParse(payload);
    if (!claims.success || claims.data.is_anonymous) return undefined;
    return { id: claims.data.sub, email: claims.data.email ?? null };
  };
}

/** How many signing keys a project publishes: none means its tokens can't be checked here. */
export async function signingKeyCount(projectUrl: string, fetcher = fetch): Promise<number> {
  const res = await fetcher(jwksUrl(projectUrl));
  if (!res.ok) throw new Error(`${jwksUrl(projectUrl)}: HTTP ${res.status}`);
  const body = z.object({ keys: z.array(z.unknown()) }).parse(await res.json());
  return body.keys.length;
}

export type AccountEnv = { Variables: { account: Account } };

/**
 * Whether an account may use the internal pages (PLAN.md M7): its sign-in email is one of the
 * admins'. With sign-in off for local development, everyone is.
 */
export function isAdmin(account: Account, auth: Auth | undefined, admins: readonly string[]) {
  if (auth?.kind === 'off') return true;
  return account.email !== null && admins.includes(account.email.toLowerCase());
}

export const refuse = (c: Context, status: 401 | 403 | 409 | 429 | 503, refusal: Refusal) =>
  c.json(refusal, status);

/**
 * The account a request is signed in as, from a valid `Authorization: Bearer` token (anyone,
 * when sign-in is off), or the response refusing it.
 */
export async function accountOf(c: Context, auth: Auth | undefined): Promise<Account | Response> {
  if (!auth) {
    return refuse(c, 503, {
      error: "Sign-in isn't set up on this server, so the AI steps aren't available.",
      code: 'auth_unavailable',
    });
  }
  let account: Account | undefined = LOCAL_ACCOUNT;
  if (auth.kind === 'verify') {
    const token = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1];
    try {
      account = token ? await auth.verify(token) : undefined;
    } catch (e) {
      console.error('Checking a session failed:', e);
      return refuse(c, 503, {
        error: "Sign-in can't be checked right now: try again in a moment.",
        code: 'auth_unavailable',
      });
    }
  }
  return (
    account ??
    refuse(c, 401, { error: 'Sign in to have the AI do this.', code: 'sign_in_required' })
  );
}

/** Lets a request through only when it's signed in, with its account in `c.var.account`. */
export function requireAccount(auth: Auth | undefined): MiddlewareHandler<AccountEnv> {
  return async (c, next) => {
    const account = await accountOf(c, auth);
    if (account instanceof Response) return account;
    c.set('account', account);
    await next();
  };
}

/**
 * Lets a request through only when it's signed in as an admin (see `isAdmin`), with its account
 * in `c.var.account`: the internal pages' routes (PLAN.md M7).
 */
export function requireAdmin(
  auth: Auth | undefined,
  admins: readonly string[],
): MiddlewareHandler<AccountEnv> {
  return async (c, next) => {
    const account = await accountOf(c, auth);
    if (account instanceof Response) return account;
    if (!isAdmin(account, auth, admins)) {
      return refuse(c, 403, { error: 'Only admins can use this page.', code: 'admin_only' });
    }
    c.set('account', account);
    await next();
  };
}
