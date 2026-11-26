// Creates a tiny packed database to exercise the browser install/query path.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { packDatabase } from '../lib/pack.mjs';
const [, , outDir, name, passphrase] = process.argv;
const file = `${outDir}.tmp.db`;
fs.rmSync(file, { force: true });
const db = new DatabaseSync(file);
db.exec(`PRAGMA page_size=4096; CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE t(id INTEGER PRIMARY KEY, title TEXT, html BLOB);
CREATE VIRTUAL TABLE fts USING fts5(title, body, content='', tokenize='unicode61 remove_diacritics 2');`);
const ins = db.prepare('INSERT INTO t(id,title,html) VALUES(?,?,?)');
const fts = db.prepare('INSERT INTO fts(rowid,title,body) VALUES(?,?,?)');
const filler = 'lorem ipsum dolor sit amet '.repeat(2000);
for (let i = 1; i <= 3000; i++) {
  const title = i === 1 ? 'Faerûn' : `Article ${i}`;
  ins.run(i, title, zlib.deflateRawSync(Buffer.from(`<p>${title} body ${filler}${i}</p>`)));
  fts.run(i, title, `${title} body ${i}`);
}
db.exec("INSERT INTO meta VALUES('version','test-1')");
db.close();
const m = packDatabase(file, outDir, { name, version: 'test-1', passphrase, partSize: 256 * 1024 });
fs.rmSync(file);
console.log(name, m.parts.length, 'parts', m.dbBytes, 'bytes');
