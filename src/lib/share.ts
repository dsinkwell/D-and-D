// Sharing by file: characters, lists, homebrew and house rules are written to a small JSON file
// ("Elandra.frref.json") that is sent with AirDrop, Messages or Mail and imported on another
// device (Saved → Import). Importing the same thing again offers to replace it, so the DM can
// send updated house rules and everyone's copy is updated rather than duplicated.
import { getRecord, listRecords, loadUserData, newId, saveRecord, type RecordType, type UserRecord } from './userdata';
import { readLocal, writeLocal } from './storage';

export const FILE_EXT = '.frref.json';

export interface ShareFile {
  app: 'fr-reference';
  format: 1;
  exported: string;
  author?: string;
  records: UserRecord[];
}

export const myName = () => readLocal<string>('rc.author', '');
export const setMyName = (n: string) => {
  writeLocal('rc.author', n.trim());
  window.dispatchEvent(new Event('rc-author')); // iCloud sync passes it to the user's other devices
};

export function shareFileFor(records: UserRecord[]): ShareFile {
  const author = myName() || undefined;
  return {
    app: 'fr-reference',
    format: 1,
    exported: new Date().toISOString(),
    author,
    records: records
      .filter((r) => !r.deleted)
      // the sender's own records go out as theirs; forwarded ones keep their first author
      .map((r) => ({ ...r, origin: r.origin || r.id, author: r.imported ? r.author : author, imported: undefined })),
  };
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'FR Reference';

/** Hand the file to the system share sheet (AirDrop, Messages, Mail…), or download it. */
export async function shareRecords(records: UserRecord[], title: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const json = JSON.stringify(shareFileFor(records), null, 1);
  const name = `${safeName(title)}${FILE_EXT}`;
  const file = new File([json], name, { type: 'application/json' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
      // fall through to a download
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'downloaded';
}

// ------------------------------------------------------------------ importing

export type Conflict = 'replace' | 'both' | 'skip';

export interface ImportPlan {
  file: ShareFile;
  fresh: UserRecord[]; // not on this device yet
  existing: { incoming: UserRecord; current: UserRecord }[]; // already here (same id or same origin)
}

export function parseShareFile(text: string): ShareFile | null {
  try {
    const d = JSON.parse(text);
    if (d?.app !== 'fr-reference' || d.format !== 1 || !Array.isArray(d.records)) return null;
    const types: RecordType[] = ['character', 'list', 'homebrew', 'houserules'];
    d.records = d.records.filter((r: any) => r && typeof r.id === 'string' && types.includes(r.type) && typeof r.name === 'string' && r.data);
    return d as ShareFile;
  } catch {
    return null;
  }
}

export async function planImport(file: ShareFile): Promise<ImportPlan> {
  await loadUserData();
  const fresh: UserRecord[] = [];
  const existing: ImportPlan['existing'] = [];
  for (const r of file.records) {
    const origin = r.origin || r.id;
    const current = getRecord(r.id) || listRecords(r.type).find((x) => (x.origin || x.id) === origin);
    if (current) existing.push({ incoming: r, current });
    else fresh.push(r);
  }
  return { file, fresh, existing };
}

/** Save an import. Records from someone else are marked imported (read-only for homebrew). */
export async function applyImport(plan: ImportPlan, onConflict: Conflict): Promise<{ added: number; replaced: number; skipped: number }> {
  const mine = myName();
  const fromOther = (r: UserRecord) => !!r.author && r.author !== mine;
  const prep = (r: UserRecord, id: string, name = r.name) => ({ ...r, id, name, origin: r.origin || r.id, imported: fromOther(r), deleted: undefined });
  let added = 0;
  let replaced = 0;
  let skipped = 0;
  for (const r of plan.fresh) {
    await saveRecord(prep(r, r.id));
    added++;
  }
  for (const { incoming, current } of plan.existing) {
    if (onConflict === 'skip') skipped++;
    else if (onConflict === 'replace') {
      await saveRecord({ ...prep(incoming, current.id), created: current.created });
      replaced++;
    } else {
      await saveRecord(prep(incoming, newId(), `${incoming.name} (copy)`));
      added++;
    }
  }
  return { added, replaced, skipped };
}
