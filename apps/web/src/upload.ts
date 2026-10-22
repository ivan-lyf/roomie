/** Longest side of an uploaded plan, in pixels: plenty to read labels, small enough to send. */
export const MAX_SIDE = 3000;

/** A size scaled down (never up) so its longest side is at most `max`. */
export function fitSize(
  width: number,
  height: number,
  max = MAX_SIDE,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** The file types a plan can be uploaded as. */
export const ACCEPTED = 'image/png,image/jpeg,image/webp,application/pdf';

const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

/**
 * Turns a dropped file into the PNG to upload: an image scaled down to `MAX_SIDE`, or a PDF's
 * first page drawn at that size, on white (plans are often transparent).
 */
export async function preparePlan(file: File): Promise<{ image: Blob; name: string }> {
  const name = file.name.replace(/\.[^.]+$/, '').trim() || 'My home';
  const canvas = document.createElement('canvas');
  if (isPdf(file)) {
    await drawPdfPage(file, canvas);
  } else {
    const bitmap = await createImageBitmap(file).catch(() => {
      throw new Error('That file is not an image this browser can read.');
    });
    const { width, height } = fitSize(bitmap.width, bitmap.height);
    Object.assign(canvas, { width, height });
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
  }
  const image = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!image) throw new Error('The plan could not be converted to an image.');
  return { image, name };
}

/** Renders a PDF's first page onto the canvas; pdf.js loads only when a PDF is dropped. */
async function drawPdfPage(file: File, canvas: HTMLCanvasElement) {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  try {
    const page = await (await task.promise).getPage(1);
    // A page is drawn, not sampled, so it can be drawn at full size whatever its paper size.
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: MAX_SIDE / Math.max(base.width, base.height) });
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport, background: '#fff' }).promise;
  } finally {
    await task.destroy();
  }
}
