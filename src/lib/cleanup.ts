// One-time tidy-up of storage left by the removed written-answers test page (#/lab, Nov 2026):
// its downloaded models (OPFS folder "lab-models", the "transformers-cache" and WebLLM caches)
// could take over 1 GB. Touches nothing else: the books/wiki databases, the Ask model
// ("ask-models") and the app's own files are left alone.
const DONE = 'cleanup-lab-v1';

export async function cleanupLabStorage() {
  try {
    if (localStorage.getItem(DONE)) return;
  } catch {
    return;
  }
  try {
    const root = await navigator.storage?.getDirectory?.();
    await root?.removeEntry('lab-models', { recursive: true }).catch(() => {});
  } catch {
    /* no OPFS or nothing there */
  }
  try {
    for (const k of await caches.keys()) if (k === 'transformers-cache' || k === 'experimental_transformers-hash-cache' || k.startsWith('webllm')) await caches.delete(k);
  } catch {
    /* no Cache API */
  }
  try {
    for (const k of ['lab-step']) localStorage.removeItem(k);
    localStorage.setItem(DONE, '1');
  } catch {
    /* private mode */
  }
}
