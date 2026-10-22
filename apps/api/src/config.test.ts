import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

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
    });
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
    expect(() => loadConfig({ ...storage, STORAGE_BUCKET: '' })).toThrow(/also set STORAGE_BUCKET/);
  });

  it('rejects an invalid PORT', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid environment/);
  });
});
