import { AwsClient } from 'aws4fetch';

/** A private bucket on an S3-compatible service: Supabase Storage today, R2 would work too. */
export type StorageConfig = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

/** How long a signed link to a file works. */
const LINK_SECONDS = 2 * 60 * 60;
/** Links are signed as of the start of the hour, so a file keeps one URL the browser can cache. */
const SIGNING_PERIOD_MS = 60 * 60 * 1000;

export function createStorage(config: StorageConfig, now: () => number = Date.now) {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: config.region,
  });
  // Path-style URLs: Supabase's S3 endpoint puts the bucket in the path.
  const base = `${config.endpoint.replace(/\/+$/, '')}/${encodeURIComponent(config.bucket)}`;
  const urlOf = (key: string) => `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;

  return {
    async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
      const res = await client.fetch(urlOf(key), {
        method: 'PUT',
        body,
        headers: { 'content-type': contentType, 'cache-control': 'max-age=3600' },
      });
      if (!res.ok) throw new Error(`PUT ${key}: HTTP ${res.status} ${await res.text()}`);
    },

    /** A file's bytes, or undefined if there's no such file. */
    async get(key: string): Promise<Uint8Array | undefined> {
      const res = await client.fetch(urlOf(key));
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`GET ${key}: HTTP ${res.status} ${await res.text()}`);
      return new Uint8Array(await res.arrayBuffer());
    },

    /** Every file in the bucket, with its MD5 (the ETag of a single-part upload). */
    async list(): Promise<Map<string, string>> {
      const files = new Map<string, string>();
      let token: string | undefined;
      do {
        const url = new URL(base);
        url.searchParams.set('list-type', '2');
        if (token) url.searchParams.set('continuation-token', token);
        const res = await client.fetch(url.href);
        if (!res.ok) throw new Error(`LIST: HTTP ${res.status} ${await res.text()}`);
        const xml = await res.text();
        for (const [, entry] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const key = /<Key>([\s\S]*?)<\/Key>/.exec(entry ?? '')?.[1];
          const etag = /<ETag>([\s\S]*?)<\/ETag>/.exec(entry ?? '')?.[1];
          if (key && etag) files.set(unescapeXml(key), unescapeXml(etag).replaceAll('"', ''));
        }
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
          ? /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1]
          : undefined;
      } while (token);
      return files;
    },

    /** A link that downloads the file without credentials, for a couple of hours. */
    async signedUrl(key: string): Promise<string> {
      const url = new URL(urlOf(key));
      url.searchParams.set('X-Amz-Expires', String(LINK_SECONDS));
      const start = Math.floor(now() / SIGNING_PERIOD_MS) * SIGNING_PERIOD_MS;
      const datetime = new Date(start).toISOString().replace(/[:-]|\.\d{3}/g, '');
      const signed = await client.sign(url.href, {
        method: 'GET',
        aws: { signQuery: true, datetime },
      });
      return signed.url;
    },
  };
}

export type Storage = ReturnType<typeof createStorage>;

function unescapeXml(text: string): string {
  return text
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}
