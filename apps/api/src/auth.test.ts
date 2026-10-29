import { Hono } from 'hono';
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type AccountEnv,
  LOCAL_ACCOUNT,
  requireAccount,
  signingKeyCount,
  supabaseVerifier,
  type TokenVerifier,
} from './auth';

const project = 'https://abc.supabase.co';
const user = '11111111-2222-4333-8444-555555555555';
let verify: TokenVerifier;
let sign: (claims?: JWTPayload, options?: { expires?: string; other?: boolean }) => Promise<string>;

beforeAll(async () => {
  // The project's signing key, and another one it never published.
  const [mine, theirs] = await Promise.all([
    generateKeyPair('ES256', { extractable: true }),
    generateKeyPair('ES256', { extractable: true }),
  ]);
  const jwk = { ...(await exportJWK(mine.publicKey)), kid: 'k1', alg: 'ES256' };
  verify = supabaseVerifier(project, createLocalJWKSet({ keys: [jwk] }));
  sign = (claims = {}, { expires = '1h', other = false } = {}) =>
    new SignJWT({
      sub: user,
      email: 'ivan@example.com',
      role: 'authenticated',
      iss: `${project}/auth/v1`,
      aud: 'authenticated',
      ...claims,
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setIssuedAt()
      .setExpirationTime(expires)
      .sign(other ? theirs.privateKey : mine.privateKey);
});

describe('supabaseVerifier', () => {
  it("knows a signed-in user's token", async () => {
    expect(await verify(await sign())).toEqual({ id: user, email: 'ivan@example.com' });
  });

  it("refuses tokens expired, from elsewhere, tampered with, anonymous or that aren't tokens", async () => {
    const good = await sign();
    const [head, body] = good.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: user, aud: 'authenticated' })).toString(
      'base64url',
    );
    const tokens = [
      await sign({}, { expires: '-1m' }),
      await sign({}, { other: true }),
      await sign({ iss: 'https://evil.example/auth/v1' }),
      await sign({ aud: 'anon' }),
      await sign({ is_anonymous: true }),
      await sign({ sub: 'not-a-uuid' }),
      `${head}.${forged}.${good.split('.')[2]}`,
      `${head}.${body}.`,
      'not a token',
    ];
    for (const token of tokens) expect(await verify(token)).toBeUndefined();
  });
});

describe('requireAccount', () => {
  const app = (auth: Parameters<typeof requireAccount>[0]) =>
    new Hono<AccountEnv>().post('/ai', requireAccount(auth), (c) => c.json(c.var.account));
  const call = (served: ReturnType<typeof app>, token?: string) =>
    served.request('/ai', {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it('lets a signed-in request through, with its account', async () => {
    const res = await call(app({ kind: 'verify', verify }), await sign());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: user, email: 'ivan@example.com' });
  });

  it('refuses a request signed out, or with a bad token, as needing sign-in', async () => {
    for (const token of [undefined, 'nonsense', await sign({}, { expires: '-1m' })]) {
      const res = await call(app({ kind: 'verify', verify }), token);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: 'Sign in to have the AI do this.',
        code: 'sign_in_required',
      });
    }
  });

  it("is unavailable when sign-in isn't set up or can't be checked", async () => {
    expect((await call(app(undefined), await sign())).status).toBe(503);
    const broken: TokenVerifier = async () => {
      throw new Error('keys unreachable');
    };
    const res = await call(app({ kind: 'verify', verify: broken }), await sign());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'auth_unavailable' });
  });

  it('lets everyone through as the local account when sign-in is off', async () => {
    const res = await call(app({ kind: 'off' }));
    expect(await res.json()).toEqual(LOCAL_ACCOUNT);
  });
});

describe('signingKeyCount', () => {
  it("counts the keys a project publishes: none when it doesn't use signing keys", async () => {
    const answer = (keys: unknown[]) => (async () => Response.json({ keys })) as typeof fetch;
    expect(await signingKeyCount(project, answer([{ kty: 'EC' }]))).toBe(1);
    expect(await signingKeyCount(project, answer([]))).toBe(0);
  });
});
