#!/usr/bin/env node
/**
 * One-time, idempotent legacy Notes -> Tiptap migration.
 *
 * Safe by default: run with --apply to write. Original legacy blocks are kept
 * untouched; migrated Tiptap nodes are stored alongside them (formatVersion=1).
 *
 * Usage:
 *   node scripts/migrate-notes-to-tiptap.js          # dry run
 *   node scripts/migrate-notes-to-tiptap.js --apply  # write
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Note = require('../models/Note');
const Chapter = require('../models/Chapter');
const NoteChunk = require('../models/NoteChunk');

const APPLY = process.argv.includes('--apply');
const FORMAT_VERSION = 1;
const TARGET_BYTES = 12000;

function textFromHtml(value = '') {
  return String(value)
    .replace(/<br\\s*\\/?\\s*>/gi, '\\n')
    .replace(/<\\/(p|div|li|h[1-6])\\s*>/gi, '\\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function inlineText(value) {
  const text = textFromHtml(value);
  return text ? [{ type: 'text', text }] : [];
}

function convertBlock(block) {
  const raw = String(block?.content || '');
  const inline = inlineText(raw);
  switch (block?.type) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return { type: 'heading', attrs: { level: Number(block.type.slice(1)) }, ...(inline.length ? { content: inline } : {}) };
    case 'image':
      if (!/^https?:\\/\\//i.test(raw.trim())) return { type: 'paragraph', ...(inline.length ? { content: inline } : {}) };
      return { type: 'paragraph', content: [{ type: 'image', attrs: { src: raw.trim(), alt: block.alt || '', title: '', position: block.position || 'center', size: block.size || 'medium', caption: block.caption || '' } }] };
    case 'divider': return { type: 'horizontalRule' };
    case 'code': return { type: 'codeBlock', attrs: { language: block.language || 'text' }, ...(raw ? { content: [{ type: 'text', text: raw }] } : {}) };
    case 'ul': case 'ol': {
      const lis = [...raw.matchAll(/<li\\b[^>]*>([\\s\\S]*?)<\\/li>/gi)].map((m) => ({
        type: 'listItem', content: [{ type: 'paragraph', ...(inlineText(m[1]).length ? { content: inlineText(m[1]) } : {}) }],
      }));
      return lis.length ? { type: block.type === 'ul' ? 'bulletList' : 'orderedList', content: lis } : { type: 'paragraph', ...(inline.length ? { content: inline } : {}) };
    }
    case 'table':
      // Keep table text rather than dropping cells when the legacy HTML is malformed.
      return { type: 'paragraph', ...(inline.length ? { content: inline } : {}) };
    case 'fact':
      return { type: 'factCard', attrs: { emoji: '💡', color: block.color || null, fontStyle: block.fontStyle || null }, content: [{ type: 'paragraph', ...(inline.length ? { content: inline } : {}) }] };
    case 'text': default:
      return { type: 'paragraph', ...(inline.length ? { content: inline } : {}) };
  }
}

function chunkNodes(nodes) {
  const groups = [];
  let current = [], bytes = 0;
  for (const node of nodes) {
    const size = Buffer.byteLength(JSON.stringify(node));
    if (current.length && bytes + size > TARGET_BYTES) { groups.push(current); current = []; bytes = 0; }
    current.push(node); bytes += size;
  }
  if (current.length) groups.push(current);
  return groups.length ? groups : [[{ type: 'paragraph' }]];
}

async function migrateNote(noteId, report) {
  let chapter = await Chapter.findOne({ noteId }).sort({ order: 1, createdAt: 1 });
  const legacyChunks = await NoteChunk.find({ noteId }).sort({ seq: 1 });
  const chunksNeedingMigration = legacyChunks.filter((chunk) =>
    (chunk.blocks || []).length && !(chunk.nodes || []).length
  );
  const rawNote = await mongoose.connection.collection('notes').findOne(
    { _id: noteId }, { projection: { blocks: 1 } }
  );
  const hasTopLevelBlocks = Array.isArray(rawNote?.blocks) && rawNote.blocks.length > 0;
  if (!chunksNeedingMigration.length && !hasTopLevelBlocks) {
    report.skipped += 1; return;
  }

  if (!chapter) {
    if (APPLY) chapter = await Chapter.create({ noteId, title: 'General', order: 0 });
    else chapter = { _id: 'DRY-RUN-CHAPTER', title: 'General' };
  }

  const sourceBlocks = chunksNeedingMigration.flatMap((chunk) => chunk.blocks || []);
  const blocks = sourceBlocks.length ? sourceBlocks : (rawNote?.blocks || []);
  const nodes = blocks.map(convertBlock).filter(Boolean);
  const groups = chunkNodes(nodes);

  report.candidates += 1;
  report.blocks += blocks.length;
  report.chunks += groups.length;

  if (!APPLY) return;

  // Reuse legacy chunk sequence slots where possible; reserve additional
  // note-wide sequence values without overwriting another chapter's chunks.
  const existing = await NoteChunk.find({ noteId, chapterId: chapter._id }).sort({ seq: 1 });
  const legacySlots = chunksNeedingMigration;
  const usedSeqs = new Set(legacySlots.map((chunk) => chunk.seq));
  const allSeqs = legacyChunks.map((chunk) => chunk.seq);
  let nextSeq = Math.max(-1, ...allSeqs) + 1;

  for (let i = 0; i < groups.length; i += 1) {
    const slot = legacySlots[i];
    let seq = slot?.seq;
    if (seq === undefined) {
      while (usedSeqs.has(nextSeq)) nextSeq += 1;
      seq = nextSeq++; usedSeqs.add(seq);
    }
    const chunkNodesForSave = groups[i];
    await NoteChunk.updateOne(
      { noteId, seq },
      { $set: { chapterId: chapter._id, nodes: chunkNodesForSave, formatVersion: FORMAT_VERSION,
        charCount: chunkNodesForSave.reduce((sum, n) => sum + JSON.stringify(n).length, 0) } },
      { upsert: true }
    );
  }
  // Deliberately retain source blocks. Cleanup is a separate, verified operation.
  report.migrated += 1;
}

async function main() {
  if (!process.env.MONGODB_URI && !process.env.MONGO_URI) {
    throw new Error('Set MONGODB_URI or MONGO_URI before running this migration.');
  }
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const cursor = Note.find({}).select('_id').lean().cursor();
  const report = { mode: APPLY ? 'APPLY' : 'DRY RUN', scanned: 0, candidates: 0, migrated: 0, skipped: 0, blocks: 0, chunks: 0, errors: [] };
  for await (const note of cursor) {
    report.scanned += 1;
    try { await migrateNote(note._id, report); }
    catch (error) { report.errors.push({ noteId: String(note._id), error: error.message }); }
  }
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
  if (report.errors.length) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
