const IMAGE_LOAD_TIMEOUT_MS = 10_000;

function waitForImage(img: HTMLImageElement): Promise<void> {
  if (img.complete) return Promise.resolve();

  return new Promise((resolve) => {
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => resolve(), { once: true });
  });
}

function withTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
  return Promise.race([
    promise,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

export async function printDoc(doc: Document = document): Promise<void> {
  const images = Array.from(doc.querySelectorAll('img[loading="lazy"]')) as HTMLImageElement[];

  for (const img of images) {
    img.loading = 'eager';
  }

  await withTimeout(Promise.all(images.map(waitForImage)).then(() => undefined), IMAGE_LOAD_TIMEOUT_MS);

  window.print();
}
