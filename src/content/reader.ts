import { readPortal } from '../portal/reader';

async function run(): Promise<void> {
  const status = (s: { state: string; message: string; warnings?: string[] }) => chrome.storage.local.set({ readerStatus: { ...s, at: Date.now() } });
  try {
    await status({ state: 'running', message: 'Starting…' });
    const { dataset, warnings } = await readPortal(
      document,
      location.href,
      async (url, init) => {
        const r = await fetch(url, init);
        return { ok: r.ok, status: r.status, url: r.url, text: await r.text() };
      },
      { delayMs: 350, onProgress: (message) => void status({ state: 'running', message }) },
    );
    const { dataset: previous } = await chrome.storage.local.get('dataset');
    await chrome.storage.local.set({ previousDataset: previous ?? null, dataset, excluded: {}, readerWarnings: warnings });
    await status({ state: 'done', message: `Read ${dataset.courses.length} courses. Open the planner to see your options.`, warnings });
  } catch (e) {
    await status({ state: 'error', message: e instanceof Error ? e.message : String(e) });
  } finally {
    document.dispatchEvent(new CustomEvent('aast-reader-finished'));
  }
}

void run();
