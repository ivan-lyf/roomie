import { readFile } from 'node:fs/promises';
import { Category } from '@roomie/schema';
import { Hono } from 'hono';
import { itemNoOf } from './catalog/ikea';
import { modelPath, readModels, readProducts } from './catalog/store';

export type AppOptions = {
  dataDir: string;
};

export function createApp({ dataDir }: AppOptions) {
  const app = new Hono().basePath('/api');

  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/products', async (c) => {
    const query = c.req.query('category');
    const category = query === undefined ? undefined : Category.safeParse(query);
    if (category && !category.success) return c.json({ error: `unknown category: ${query}` }, 400);
    const [all, models] = await Promise.all([readProducts(dataDir), readModels(dataDir)]);
    const products = all.filter((p) => !category || p.category === category.data);
    // The model pipeline decides what each product shows: its IKEA model or a stand-in.
    return c.json(
      products.map((p) => {
        const itemNo = itemNoOf(p);
        const source = models.get(itemNo)?.source;
        if (!source) return { ...p, modelUrl: null };
        const modelUrl = new URL(`/api/models/${itemNo}.glb`, c.req.url).href;
        return { ...p, modelSource: source, modelUrl };
      }),
    );
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
