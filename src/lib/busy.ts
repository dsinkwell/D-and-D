// Long operations (database downloads, model downloads, writing an answer) mark themselves busy
// so an app update never reloads the page in the middle of them.
const active = new Set<string>();
const waiters: (() => void)[] = [];

export async function whileBusy<T>(name: string, work: () => Promise<T>): Promise<T> {
  active.add(name);
  try {
    return await work();
  } finally {
    active.delete(name);
    if (!active.size) waiters.splice(0).forEach((f) => f());
  }
}

export const isBusy = () => active.size > 0;

/** Resolves when nothing is busy. */
export const whenIdle = () => (active.size ? new Promise<void>((res) => waiters.push(res)) : Promise.resolve());
