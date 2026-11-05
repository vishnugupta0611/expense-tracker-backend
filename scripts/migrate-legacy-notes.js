// Migrates only the authenticated account. Dry-run by default; --apply writes
// a private backup before each revision-checked API save.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { JSDOM } = require('jsdom');

async function main() {
  const token = process.env.NOTES_MIGRATION_TOKEN;
  if (!token) throw new Error('Set NOTES_MIGRATION_TOKEN for the account to migrate.');
  const base = (process.env.NOTES_MIGRATION_API || 'http://127.0.0.1:5000/api').replace(/\/$/, '');
  const apply = process.argv.includes('--apply');
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  global.document = dom.window.document;
  global.Node = dom.window.Node;
  const converter = path.resolve(__dirname, '../../Frontend/src/utils/notes/legacyBlocksToTiptap.js');
  const { legacyBlocksToTiptapDocument } = await import(pathToFileURL(converter).href);
  async function api(url, method = 'GET', body) {
    const res = await fetch(base + url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
  const notes = (await api('/notes')).notes || [];
  const backupDir = path.resolve(__dirname, '../migration-backups');
  if (apply) fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  let found = 0, migrated = 0, skipped = 0;
  for (const note of notes) {
    try {
      const chapters = (await api(`/notes/${note._id}/chapters`)).chapters || [];
      for (const chapter of chapters) {
        const snapshot = await api(`/notes/${note._id}/chapters/${chapter._id}/content`);
        if (snapshot.document || !snapshot.legacyBlocks?.length) continue;
        found++;
        const blocks = snapshot.legacyBlocks;
        const doc = legacyBlocksToTiptapDocument(blocks);
        const imageBlocks = blocks.filter(b => b.type === 'image').length;
        const countImages = n => (n.type === 'image' ? 1 : 0) + (n.content || []).reduce((sum, child) => sum + countImages(child), 0);
        if (countImages(doc) !== imageBlocks || blocks.some(b => !['h1','h2','h3','h4','h5','h6','text','image','code','divider','ul','ol','fact','table'].includes(b.type))) {
          skipped++; console.warn(`Skipped ${note._id}/${chapter._id}: conversion needs review`); continue;
        }
        if (!apply) continue;
        const backup = path.join(backupDir, `${note._id}-${chapter._id}-${Date.now()}.json`);
        fs.writeFileSync(backup, JSON.stringify({ note, snapshot, convertedDocument: doc }, null, 2), { flag: 'wx', mode: 0o600 });
        await api(`/notes/${note._id}/chapters/${chapter._id}/content`, 'PUT', { document: doc, revision: snapshot.chapter.revision });
        migrated++;
      }
    } catch (error) { skipped++; console.error(`Skipped note ${note._id}: ${error.message}`); }
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', notes: notes.length, legacyChapters: found, migrated, skipped }));
  if (skipped) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
