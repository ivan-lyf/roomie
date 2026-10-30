import { describe, expect, it } from 'vitest';
import { DEFAULT_GEMINI_MODELS, loadConfig } from './config';

describe('loadConfig', () => {
  it('uses defaults and treats empty values as unset', () => {
    const config = loadConfig({ PORT: '', DATABASE_URL: '', DATA_DIR: '' });
    expect(config.port).toBe(8787);
    expect(config.databaseUrl).toBeUndefined();
    expect(config.dataDir).toMatch(/[\\/]data$/);
  });

  it('reads PORT, DATABASE_URL and DATA_DIR', () => {
    expect(
      loadConfig({ PORT: '9000', DATABASE_URL: 'postgresql://u:p@h:5432/db', DATA_DIR: '/d' }),
    ).toEqual({
      port: 9000,
      databaseUrl: 'postgresql://u:p@h:5432/db',
      dataDir: '/d',
      storage: undefined,
      plansStorage: undefined,
      reader: undefined,
      readers: {},
      layout: undefined,
      auth: undefined,
      allowance: { dailyUsd: 1, timeZone: 'America/Vancouver' },
      admins: [],
    });
  });

  it('reads the admins as a list of emails in lower case', () => {
    expect(loadConfig({ ADMIN_EMAILS: ' Ivan@Example.com, ,b@example.com' }).admins).toEqual([
      'ivan@example.com',
      'b@example.com',
    ]);
  });

  it('accepts Supabase sessions with a project URL, or anyone with AUTH=off, but not in production', () => {
    expect(loadConfig({ SUPABASE_URL: 'https://abc.supabase.co/' }).auth).toEqual({
      kind: 'supabase',
      url: 'https://abc.supabase.co',
    });
    expect(loadConfig({ AUTH: 'off', SUPABASE_URL: 'https://abc.supabase.co' }).auth).toEqual({
      kind: 'off',
    });
    expect(() => loadConfig({ AUTH: 'off', NODE_ENV: 'production' })).toThrow(/AUTH=off/);
    expect(() => loadConfig({ AUTH: 'supabase' })).toThrow(/needs SUPABASE_URL/);
  });

  it('reads the daily allowance and its time zone', () => {
    const config = loadConfig({ DAILY_ALLOWANCE_USD: '0.5', ALLOWANCE_TIME_ZONE: 'Europe/Paris' });
    expect(config.allowance).toEqual({ dailyUsd: 0.5, timeZone: 'Europe/Paris' });
    expect(loadConfig({ DAILY_ALLOWANCE_USD: '0' }).allowance.dailyUsd).toBe(0);
    expect(() => loadConfig({ ALLOWANCE_TIME_ZONE: 'Mars/Olympus' })).toThrow(/time zone/);
    expect(() => loadConfig({ DAILY_ALLOWANCE_USD: '-1' })).toThrow();
  });

  it('furnishes homes with Claude on the same key, with a model of its own', () => {
    expect(loadConfig({ CLAUDE_API_KEY: 'c' }).layout).toEqual({
      apiKey: 'c',
      model: 'claude-haiku-5-5',
      effort: 'medium',
    });
    const set = { CLAUDE_API_KEY: 'c', LAYOUT_MODEL: 'claude-sonnet-5-5', LAYOUT_EFFORT: 'low' };
    expect(loadConfig(set).layout).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'low' });
    expect(loadConfig({ GEMINI_API_KEY: 'g' }).layout).toBeUndefined();
  });

  it('reads plans with Gemini when there is a key, unless told not to', () => {
    expect(loadConfig({ GEMINI_API_KEY: 'key' }).reader).toEqual({
      provider: 'gemini',
      apiKey: 'key',
      models: DEFAULT_GEMINI_MODELS,
    });
    const models = (GEMINI_MODEL: string) =>
      loadConfig({ GEMINI_API_KEY: 'key', GEMINI_MODEL }).readers.gemini?.models;
    expect(models('gemini-x')).toEqual(['gemini-x']);
    expect(models(' gemini-x, gemini-y ,')).toEqual(['gemini-x', 'gemini-y']);
    expect(loadConfig({ GEMINI_API_KEY: 'key', PLAN_READER: 'none' }).reader).toBeUndefined();
    expect(() => loadConfig({ PLAN_READER: 'gemini' })).toThrow(/needs GEMINI_API_KEY/);
  });

  it('reads plans with Claude when told to, or when it has the only key', () => {
    const claude = { provider: 'claude', apiKey: 'c', model: 'claude-opus-5-5', effort: 'medium' };
    expect(loadConfig({ CLAUDE_API_KEY: 'c' }).reader).toEqual(claude);
    expect(loadConfig({ ANTHROPIC_API_KEY: 'c' }).reader).toEqual(claude);
    const both = { GEMINI_API_KEY: 'g', CLAUDE_API_KEY: 'c' };
    expect(loadConfig(both).reader?.provider).toBe('gemini');
    expect(loadConfig(both).readers.claude).toEqual(claude);
    expect(loadConfig({ ...both, PLAN_READER: 'claude' }).reader).toEqual(claude);
    expect(
      loadConfig({ CLAUDE_API_KEY: 'c', CLAUDE_MODEL: 'claude-haiku-5-5', CLAUDE_EFFORT: 'low' })
        .reader,
    ).toMatchObject({ model: 'claude-haiku-5-5', effort: 'low' });
    expect(() => loadConfig({ PLAN_READER: 'claude' })).toThrow(/needs CLAUDE_API_KEY/);
    expect(() => loadConfig({ CLAUDE_API_KEY: 'c', CLAUDE_EFFORT: 'huge' })).toThrow();
  });

  it('reads the storage settings as a set', () => {
    const storage = {
      STORAGE_ENDPOINT: 'https://abc.storage.supabase.co/storage/v1/s3',
      STORAGE_REGION: 'us-west-2',
      STORAGE_ACCESS_KEY_ID: 'id',
      STORAGE_SECRET_ACCESS_KEY: 'secret',
      STORAGE_BUCKET: 'models',
    };
    expect(loadConfig(storage).storage).toEqual({
      endpoint: 'https://abc.storage.supabase.co/storage/v1/s3',
      region: 'us-west-2',
      accessKeyId: 'id',
      secretAccessKey: 'secret',
      bucket: 'models',
    });
    expect(loadConfig(storage).plansStorage?.bucket).toBe('plans');
    expect(loadConfig({ ...storage, STORAGE_PLANS_BUCKET: 'p' }).plansStorage?.bucket).toBe('p');
    expect(() => loadConfig({ ...storage, STORAGE_BUCKET: '' })).toThrow(/also set STORAGE_BUCKET/);
  });

  it('rejects an invalid PORT', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid environment/);
  });
});
