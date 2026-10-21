import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('uses defaults and treats empty values as unset', () => {
    expect(loadConfig({ PORT: '', DATABASE_URL: '' })).toEqual({
      port: 8787,
      databaseUrl: undefined,
    });
  });

  it('reads PORT and DATABASE_URL', () => {
    expect(loadConfig({ PORT: '9000', DATABASE_URL: 'postgresql://u:p@h:5432/db' })).toEqual({
      port: 9000,
      databaseUrl: 'postgresql://u:p@h:5432/db',
    });
  });

  it('rejects an invalid PORT', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid environment/);
  });
});
