import { optimizeLocally } from './optimization-core.js';

let controller;
self.addEventListener('message', async event => {
  if (event.data?.type === 'cancel') { controller?.abort(); return; }
  if (event.data?.type !== 'start') return;
  controller = new AbortController();
  try {
    const { timetable, options } = event.data;
    const result = await optimizeLocally(timetable, {
      ...options,
      signal: controller.signal,
      onProgress: progress => self.postMessage({ type: 'progress', progress }),
    });
    self.postMessage({ type: 'result', result: { ...result, assignments: result.assignments ? [...result.assignments] : undefined } });
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || 'Errore durante il calcolo.' });
  }
});
