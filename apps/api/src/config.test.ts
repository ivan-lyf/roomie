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
    });
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
