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
    ).toEqual({ port: 9000, databaseUrl: 'postgresql://u:p@h:5432/db', dataDir: '/d' });
  });

  it('rejects an invalid PORT', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid environment/);
  });
});
