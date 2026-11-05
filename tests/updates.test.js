const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Daily = require('../models/TodayUpdate');
const Category = require('../models/Category');
const Note = require('../models/Note');
const Chapter = require('../models/Chapter');
const Chunk = require('../models/NoteChunk');
const router = require('../routes/updates');
process.env.JWT_SECRET = 'test-secret';
const a = new mongoose.Types.ObjectId(), b = new mongoose.Types.ObjectId();
const token = id => jwt.sign({ userId: String(id) }, process.env.JWT_SECRET);
let db = { daily: {}, categories: {}, notes: {}, chapters: {}, chunks: {} }, failChunk = false;
const id = x => String(x);
const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));
const query = f => ({ select() { return this; }, sort() { return this; }, session() { return this; }, lean: async () => clone(f()), then(resolve, reject) { return Promise.resolve(f()).then(resolve, reject); } });
User.findById = async userId => [id(a), id(b)].includes(userId) ? { _id: new mongoose.Types.ObjectId(userId) } : null;
Daily.collection.createIndex = Category.collection.createIndex = async () => 'unique';
Daily.findOne = q => query(() => db.daily[`${q.userId}:${q.day}`]);
Daily.findOneAndUpdate = (q, u) => query(() => {
  const k = `${q.userId}:${q.day}`; let row = db.daily[k];
  if (row && row.wordCount > q.wordCount.$lte) { const e = new Error('duplicate'); e.code = 11000; throw e; }
  if (!row) row = db.daily[k] = { userId: id(q.userId), day: q.day, wordCount: 0, entries: [] };
  row.wordCount += u.$inc.wordCount; row.entries.push(clone(u.$push.entries)); return row;
});
Category.findOne = q => query(() => Object.values(db.categories).find(x => id(x.userId) === id(q.userId)));
Category.create = async ([obj]) => { const row = { ...clone(obj), _id: id(new mongoose.Types.ObjectId()) }; db.categories[row._id] = row; return [row]; };
Note.create = async ([obj]) => { db.notes[id(obj._id)] = clone(obj); return [obj]; };
Chapter.create = async ([obj]) => { db.chapters[id(obj._id)] = { ...clone(obj), revision: 0 }; return [obj]; };
Chunk.create = async ([obj]) => { if (failChunk) throw new Error('simulated failure'); db.chunks[id(obj.chapterId)] = clone(obj); return [obj]; };
Note.findOne = q => query(() => { const n = db.notes[id(q._id)]; return n && id(n.userId) === id(q.userId) ? n : null; });
Chapter.findOne = q => query(() => { const c = db.chapters[id(q._id)]; return c && id(c.noteId) === id(q.noteId) ? c : null; });
Chunk.find = q => query(() => { const c = db.chunks[id(q.chapterId)]; return c && id(c.noteId) === id(q.noteId) ? [c] : []; });
let chain = Promise.resolve();
mongoose.startSession = async () => ({ async withTransaction(fn) {
  let release; const previous = chain; chain = new Promise(r => { release = r; }); await previous;
  const before = clone(db);
  try { await fn(); } catch (e) { db = before; throw e; } finally { release(); }
}, async endSession() {} });
const app = express(); app.use(express.json()); app.use('/api/updates', router);
let server, base;
test.before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}/api/updates/today`; });
test.after(() => server.close());
async function request(method, user, body) {
  const res = await fetch(base, { method, headers: { ...(user ? { Authorization: `Bearer ${token(user)}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: await res.json() };
}
test('India midnight and inline word count', () => {
  assert.equal(router.indiaDay(new Date('2026-11-04T18:29:59Z')), '2026-11-04');
  assert.equal(router.indiaDay(new Date('2026-11-04T18:30:00Z')), '2026-11-05');
  assert.equal(router.countWords(router.documentText({type:'paragraph',content:[{type:'text',text:'hel'},{type:'text',text:'lo world'}]})), 2);
});
test('rich content is validated, stored in AI Notes and read from chapter', async () => {
  assert.equal((await request('GET')).status, 401);
  const document = { type:'doc', content:[{type:'paragraph', content:[{type:'text',text:'Hello ',marks:[{type:'bold'}]},{type:'text',text:'world'},{type:'image',attrs:{src:'https://example.com/a.png',caption:'a visual'}}]}] };
  const result = await request('POST', a, { document });
  assert.equal(result.status, 201); assert.equal(result.body.wordCount, 4);
  const entry = result.body.entries[0];
  assert.equal(db.categories[id(db.notes[entry.noteId].categoryId)].name, 'AI');
  assert.equal(db.chunks[entry.chapterId].nodes[0].content[2].attrs.src, 'https://example.com/a.png');
  assert.equal((await request('GET', b)).body.entries.length, 0);
  db.chunks[entry.chapterId].nodes = [{type:'paragraph',content:[{type:'text',text:'edited'}]}];
  const current = await request('GET', a);
  assert.equal(current.body.entries[0].document.content[0].content[0].text, 'edited');
  assert.equal(current.body.wordCount, 4); // quota records submitted words
  db.chapters[entry.chapterId].writeLock = true;
  assert.equal((await request('GET', a)).status, 409);
  db.chapters[entry.chapterId].writeLock = false;
  delete db.chapters[entry.chapterId];
  assert.equal((await request('GET', a)).body.entries[0].missing, true);
  const bad = { type:'doc',content:[{type:'paragraph',content:[{type:'image',attrs:{src:'javascript:alert(1)',caption:'bad'}}]}] };
  assert.equal((await request('POST', a, { document: bad })).status, 400);
});
test('transaction failure rolls back quota and notes', async () => {
  db = { daily: {}, categories: {}, notes: {}, chapters: {}, chunks: {} }; failChunk = true;
  assert.equal((await request('POST', a, { text:'hello' })).status, 503);
  failChunk = false;
  assert.equal((await request('GET', a)).body.wordCount, 0);
  assert.equal(Object.keys(db.notes).length, 0);
});
test('concurrent submissions retain all accepted entries and enforce quota', async () => {
  db = { daily: {}, categories: {}, notes: {}, chapters: {}, chunks: {} };
  const text = Array(800).fill('word').join(' ');
  const results = await Promise.all([request('POST', a, { text }), request('POST', a, { text })]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal((await request('GET', a)).body.wordCount, 800);
  assert.equal((await request('POST', a, { text: Array(700).fill('x').join(' ') })).status, 201);
  const state = (await request('GET', a)).body;
  assert.equal(state.wordCount, 1500); assert.equal(state.entries.length, 2);
  assert.equal(Object.keys(db.notes).length, 2);
});

test('push is owner-targeted, data-only, and delivery failures are ignored', async () => {
  const { sendUpdatePush } = require('../routes/updatesPush');
  let payload;
  await sendUpdatePush('owner-token', '2026-11-05', 42, () => ({ send: async x => { payload = x; } }));
  assert.equal(payload.token, 'owner-token');
  assert.deepEqual(payload.data, { type: 'today_updates_changed', screen: 'summary', date: '2026-11-05', count: '42', target: '1500' });
  assert.equal(payload.notification, undefined);
  assert.equal(payload.apns.payload.aps.contentAvailable, true);
  await assert.doesNotReject(sendUpdatePush('', '2026-11-05', 42, () => { throw new Error('should not load'); }));
  await assert.doesNotReject(sendUpdatePush('owner-token', '2026-11-05', 42, () => ({ send: async () => { throw new Error('offline'); } })));
});
