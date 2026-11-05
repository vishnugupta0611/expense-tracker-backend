const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const TodayUpdate = require('../models/TodayUpdate');
const Category = require('../models/Category');
const Note = require('../models/Note');
const Chapter = require('../models/Chapter');
const NoteChunk = require('../models/NoteChunk');
const { sanitizeDocument } = require('./updatesDocument');
const { sendUpdatePush } = require('./updatesPush');

const router = express.Router();
const LIMIT = 1500;
const MAX_BYTES = 100000;
const indiaDay = (date = new Date()) => new Date(date.getTime() + 330 * 60000).toISOString().slice(0, 10);
const countWords = text => (text.trim().match(/\S+/gu) || []).length;
const documentFor = text => ({ type: 'doc', content: text.split(/\r?\n/).map(line => line
  ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }) });
// Join inline text nodes before counting: changing marks must not change the quota.
function documentText(node) {
  if (node.type === 'text') return node.text;
  if (node.type === 'hardBreak') return ' ';
  if (node.type === 'image') return ` ${node.attrs?.caption || ''} `;
  const inline = ['paragraph', 'heading', 'codeBlock'].includes(node.type);
  return (node.content || []).map(documentText).join(inline ? '' : ' ');
}
const response = (day, update) => ({ day, timezone: 'Asia/Kolkata', targetWords: LIMIT,
  suggestedMinutes: { min: 5, max: 10 }, wordCount: update?.wordCount || 0,
  remainingWords: LIMIT - (update?.wordCount || 0), entries: update?.entries || [] });

// Entries created by the new API refer to live Notes chapters; old text-only
// entries remain readable. Reject a concurrently changing chapter snapshot.
async function loadEntries(userId, update) {
  if (!update) return update;
  const entries = [];
  for (const entry of update.entries || []) {
    if (!entry.noteId || !entry.chapterId) { entries.push(entry); continue; }
    const note = await Note.findOne({ _id: entry.noteId, userId }).select('_id').lean();
    const chapter = note && await Chapter.findOne({ _id: entry.chapterId, noteId: entry.noteId }).lean();
    if (!chapter) { entries.push({ ...entry, missing: true }); continue; }
    if (chapter.writeLock) { const err = new Error('An update chapter is being saved; retry'); err.status = 409; throw err; }
    const chunks = await NoteChunk.find({ noteId: entry.noteId, chapterId: entry.chapterId }).sort({ seq: 1 }).lean();
    const after = await Chapter.findOne({ _id: entry.chapterId, noteId: entry.noteId }).select('revision writeLock').lean();
    if (!after || after.writeLock || (after.revision || 0) !== (chapter.revision || 0)) {
      const err = new Error('An update chapter changed while loading; retry'); err.status = 409; throw err;
    }
    const nodes = chunks.flatMap(c => c.nodes || []);
    entries.push({ ...entry, document: { type: 'doc', content: nodes.length ? nodes : [{ type: 'paragraph' }] }, revision: chapter.revision || 0 });
  }
  return { ...update, entries };
}
router.use(auth);
router.get('/today', async (req, res) => {
  try {
    const day = indiaDay();
    const update = await TodayUpdate.findOne({ userId: req.userId, day }).lean();
    res.json(response(day, await loadEntries(req.userId, update)));
  } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Failed to load today updates' }); }
});
router.post('/today', async (req, res) => {
  const { text, document } = req.body || {};
  if ((typeof text === 'string') === (document !== undefined)) return res.status(400).json({ error: 'Provide exactly one of text or document' });
  let clean, words;
  try {
    const raw = document === undefined ? documentFor(text) : document;
    if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > MAX_BYTES) throw new Error('Document exceeds 100000 bytes');
    clean = sanitizeDocument(raw);
    words = countWords(documentText(clean));
    if (!words) throw new Error('Update must contain text or an image caption');
    if (words > LIMIT) throw new Error('Update exceeds the 1500 word daily limit');
  } catch (error) { return res.status(400).json({ error: error.message }); }
  const day = indiaDay();
  try {
    await TodayUpdate.collection.createIndex({ userId: 1, day: 1 }, { unique: true });
    await Category.collection.createIndex({ userId: 1, name: 1 }, { unique: true });
    let saved;
    for (let attempt = 0; attempt < 4; attempt++) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          let category = await Category.findOne({ userId: req.userId, name: /^AI$/i }).session(session);
          if (!category) [category] = await Category.create([{ userId: req.userId, name: 'AI' }], { session });
          const noteId = new mongoose.Types.ObjectId();
          const chapterId = new mongoose.Types.ObjectId();
          const entry = { noteId, chapterId, wordCount: words, createdAt: new Date() };
          saved = await TodayUpdate.findOneAndUpdate(
            { userId: req.userId, day, wordCount: { $lte: LIMIT - words } },
            { $inc: { wordCount: words }, $push: { entries: entry } },
            { upsert: true, new: true, setDefaultsOnInsert: false, session }
          ).lean();
          await Note.create([{ _id: noteId, userId: req.userId, categoryId: category._id,
            title: `Today Updates — ${day}`, chunkSeqCounter: 0 }], { session });
          await Chapter.create([{ _id: chapterId, noteId, title: 'Update', order: 0 }], { session });
          await NoteChunk.create([{ noteId, chapterId, seq: 0, nodes: clean.content, formatVersion: 1,
            charCount: documentText(clean).length }], { session });
        });
        break;
      } catch (error) {
        if (error.code !== 11000) throw error;
        const current = await TodayUpdate.findOne({ userId: req.userId, day }).lean();
        if (current && current.wordCount + words > LIMIT) {
          return res.status(409).json({ error: 'Daily word limit exceeded', ...response(day, await loadEntries(req.userId, current)) });
        }
        if (attempt === 3) throw error;
      } finally { await session.endSession(); }
    }
    // Advisory data-only push to the owner's registered device after commit.
    void sendUpdatePush(req.user?.fcmtoken, day, saved.wordCount);
    // The transaction is committed; never report failure merely because an editor
    // is concurrently saving while we assemble the response.
    try {
      saved = await loadEntries(req.userId, saved);
      res.status(201).json(response(day, saved));
    } catch (error) {
      const last = saved.entries.length - 1;
      saved.entries[last].document = clean;
      res.status(201).json({ ...response(day, saved), contentRefreshRequired: true });
    }
  } catch (error) {
    console.error('Today update transaction failed:', error.message);
    res.status(503).json({ error: 'Unable to save update atomically; a transaction-capable database is required' });
  }
});
module.exports = router;
module.exports.indiaDay = indiaDay;
module.exports.countWords = countWords;
module.exports.documentFor = documentFor;
module.exports.documentText = documentText;
