import { booksReady } from './books';
import { query as dbQuery } from './db';
export { booksReady };
/** Number of built-in book entries per kind (for the Rules tiles). */
export async function query(): Promise<Record<string, number>> {
  const rows = await dbQuery<{ kind: string; n: number }>('books', "SELECT kind, count(*) n FROM entries WHERE kind != 'rule' GROUP BY kind");
  return Object.fromEntries(rows.map((r) => [r.kind, r.n]));
}
