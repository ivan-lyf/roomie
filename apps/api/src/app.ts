import { access, readFile } from 'node:fs/promises';
import { Category } from '@roomie/schema';
import { Hono } from 'hono';
import { itemNoOf } from './catalog/ikea';
import { modelPath, readProducts } from './catalog/store';

export type AppOptions = {
  dataDir: string;
};

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

export function createApp({ dataDir }: AppOptions) {
  const app = new Hono().basePath('/api');

  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/products', async (c) => {
    const query = c.req.query('category');
    const category = query === undefined ? undefined : Category.safeParse(query);
    if (category && !category.success) return c.json({ error: `unknown category: ${query}` }, 400);
    const products = (await readProducts(dataDir)).filter(
      (p) => !category || p.category === category.data,
    );
    // M0 serves processed models from disk; M1 stores their R2 URLs in the catalog.
    const withModels = await Promise.all(
      products.map(async (p) => {
        const itemNo = itemNoOf(p);
        if (!(await exists(modelPath(dataDir, itemNo)))) return p;
        return { ...p, modelUrl: new URL(`/api/models/${itemNo}.glb`, c.req.url).href };
      }),
    );
    return c.json(withModels);
  });

  app.get('/models/:file', async (c) => {
    const match = /^(\d{8})\.glb$/.exec(c.req.param('file'));
    if (!match?.[1]) return c.notFound();
    let body: Buffer;
    try {
      body = await readFile(modelPath(dataDir, match[1]));
    } catch {
      return c.notFound();
    }
    return c.body(new Uint8Array(body), 200, { 'content-type': 'model/gltf-binary' });
  });

  return app;
}
