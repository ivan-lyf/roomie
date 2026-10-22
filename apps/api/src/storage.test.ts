import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStorage } from './storage';

const config = {
  endpoint: 'https://abc.storage.supabase.co/storage/v1/s3/',
  region: 'us-west-2',
  accessKeyId: 'key-id',
  secretAccessKey: 'secret',
  bucket: 'models',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const page = (files: [string, string][], next?: string) =>
  `<ListBucketResult>${files
    .map(([key, md5]) => `<Contents><Key>${key}</Key><ETag>&quot;${md5}&quot;</ETag></Contents>`)
    .join('')}<IsTruncated>${next ? 'true' : 'false'}</IsTruncated>${
    next ? `<NextContinuationToken>${next}</NextContinuationToken>` : ''
  }</ListBucketResult>`;

describe('createStorage', () => {
  it('lists every page of files with their MD5', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (req: Request) => {
        urls.push(req.url);
        const token = new URL(req.url).searchParams.get('continuation-token');
        return new Response(
          token ? page([['22222222.glb', 'bbb']]) : page([['11111111.glb', 'aaa']], 't1'),
        );
      }),
    );
    const files = await createStorage(config).list();
    expect(Object.fromEntries(files)).toEqual({ '11111111.glb': 'aaa', '22222222.glb': 'bbb' });
    expect(urls[0]).toMatch(/^https:\/\/abc\.storage\.supabase\.co\/storage\/v1\/s3\/models\?/);
  });

  it('uploads with a signed PUT', async () => {
    const requests: Request[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (req: Request) => {
        requests.push(req);
        return new Response('');
      }),
    );
    await createStorage(config).put('11111111.glb', new Uint8Array([1, 2]), 'model/gltf-binary');
    const [req] = requests;
    expect(req?.method).toBe('PUT');
    expect(req?.url).toBe('https://abc.storage.supabase.co/storage/v1/s3/models/11111111.glb');
    expect(req?.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=key-id\//);
  });

  it('downloads a file, or nothing when it is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (req: Request) =>
        req.url.endsWith('/plan.png')
          ? new Response(new Uint8Array([7, 8]))
          : new Response('', { status: 404 }),
      ),
    );
    const storage = createStorage(config);
    expect(await storage.get('plan.png')).toEqual(new Uint8Array([7, 8]));
    expect(await storage.get('gone.png')).toBeUndefined();
  });

  it('fails on an error response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })));
    await expect(createStorage(config).put('x.glb', new Uint8Array(), 'model/gltf-binary')).rejects.toThrow(
      /HTTP 403/,
    );
  });

  it('signs links that stay the same within the hour', async () => {
    const at = (iso: string) => createStorage(config, () => Date.parse(iso)).signedUrl('11111111.glb');
    const first = await at('2026-10-22T10:05:00Z');
    expect(await at('2026-10-22T10:55:00Z')).toBe(first);
    expect(await at('2026-10-22T11:05:00Z')).not.toBe(first);
    const url = new URL(first);
    expect(url.pathname).toBe('/storage/v1/s3/models/11111111.glb');
    expect(url.searchParams.get('X-Amz-Date')).toBe('20261022T100000Z');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('7200');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });
});
