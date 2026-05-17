const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const https    = require('https');
const mongoose = require('mongoose');
const auth     = require('../middleware/auth');
const Note     = require('../models/Note');
const NoteChunk = require('../models/NoteChunk');
const { Types: { ObjectId } } = mongoose;

const CHUNK_CHAR_LIMIT = 4000;

// ── Chunk helpers ─────────────────────────────────────────────────────────────

// Split a flat blocks array into chunks of ~CHUNK_CHAR_LIMIT chars each
function splitIntoChunks(blocks) {
  const chunks = [];
  let current = [];
  let count   = 0;

  for (const block of blocks) {
    const len = (block.content || '').length;
    // Always start a new chunk if current is non-empty and would overflow
    if (current.length > 0 && count + len > CHUNK_CHAR_LIMIT) {
      chunks.push(current);
      current = [];
      count   = 0;
    }
    current.push(block);
    count += len;
  }
  if (current.length > 0) chunks.push(current);
  if (chunks.length === 0) chunks.push([]); // always at least one chunk
  return chunks;
}

// Upsert all chunks for a note, delete stale ones
async function saveChunks(noteId, blocks) {
  const groups = splitIntoChunks(blocks);
  const id = typeof noteId === 'string' ? new ObjectId(noteId) : noteId;
  const ops = groups.map((grp, seq) => ({
    updateOne: {
      filter: { noteId: id, seq },
      update: {
        $set: {
          blocks:    grp,
          charCount: grp.reduce((s, b) => s + (b.content || '').length, 0),
        },
      },
      upsert: true,
    },
  }));
  await NoteChunk.bulkWrite(ops);
  await NoteChunk.deleteMany({ noteId: id, seq: { $gte: groups.length } });
}

// Fetch and flatten all chunks for a note
async function loadBlocks(noteId) {
  const chunks = await NoteChunk.find({ noteId }).sort({ seq: 1 }).lean();
  return chunks.flatMap(c => c.blocks);
}

// ── Cloudinary helpers ────────────────────────────────────────────────────────

function makeSignature(folder, timestamp) {
  const secret = process.env.CLOUDINARY_API_SECRET;
  return crypto.createHash('sha1')
    .update(`folder=${folder}&timestamp=${timestamp}${secret}`)
    .digest('hex');
}

const uploadToCloudinary = (base64Data, mimeType) =>
  new Promise((resolve, reject) => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey    = process.env.CLOUDINARY_API_KEY;
    const timestamp = Math.floor(Date.now() / 1000);
    const folder    = 'spendly_notes';
    const signature = makeSignature(folder, timestamp);

    const payload  = JSON.stringify({ file: `data:${mimeType};base64,${base64Data}`, api_key: apiKey, timestamp: String(timestamp), signature, folder });
    const bodyLen  = Buffer.byteLength(payload, 'utf8');
    const options  = { hostname: 'api.cloudinary.com', path: `/v1_1/${cloudName}/image/upload`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': bodyLen } };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const p = JSON.parse(data);
          if (p.secure_url) resolve(p.secure_url);
          else reject(new Error(p.error?.message || 'Upload failed'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(payload, 'utf8');
    req.end();
  });

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/notes/upload-image
router.post('/upload-image', auth, async (req, res) => {
  try {
    const { base64, mimeType } = req.body;
    if (!base64 || !mimeType) return res.status(400).json({ error: 'base64 and mimeType required' });
    const url = await uploadToCloudinary(base64, mimeType);
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: 'Image upload failed', detail: e.message });
  }
});

// GET /api/notes/upload-signature — signed params for direct browser upload
router.get('/upload-signature', auth, (req, res) => {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const folder    = 'spendly_notes';
    res.json({
      timestamp,
      signature: makeSignature(folder, timestamp),
      apiKey:    process.env.CLOUDINARY_API_KEY,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      folder,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate signature' });
  }
});

// GET /api/notes/public/:id — read-only, metadata + first 3 chunks
router.get('/public/:id', async (req, res) => {
  try {
    const note = await Note.findById(req.params.id).lean();
    if (!note) return res.status(404).json({ error: 'Note not found' });

    // Migrate old note formats on the fly
    if (note.blocks && note.blocks.length > 0) {
      await saveChunks(note._id, note.blocks);
      await Note.updateOne({ _id: note._id }, { $unset: { blocks: "" } });
      note.blocks = undefined;
    }

    const chunks = await NoteChunk.find({ noteId: note._id, seq: { $lt: 2 } })
      .sort({ seq: 1 })
      .lean();
    const blocks = chunks.flatMap(c => c.blocks);
    const totalChunks = await NoteChunk.countDocuments({ noteId: note._id });
    res.json({ note: { ...note, blocks, totalChunks } });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch note' });
  }
});

// GET /api/notes/public/:id/chunks — read-only progressive chunks
router.get('/public/:id/chunks', async (req, res) => {
  try {
    const noteId = req.params.id;
    const note = await Note.findById(noteId).select('_id').lean();
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const startSeq = parseInt(req.query.startSeq) || 0;
    const limit = parseInt(req.query.limit) || 3;

    const chunks = await NoteChunk.find({ noteId: note._id, seq: { $gte: startSeq } })
      .sort({ seq: 1 })
      .limit(limit)
      .lean();

    res.json({ chunks });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch chunks' });
  }
});


// GET /api/notes — list (no blocks, just metadata)
router.get('/', auth, async (req, res) => {
  try {
    const notes = await Note.find({ userId: req.userId })
      .select('title updatedAt createdAt')
      .sort({ updatedAt: -1 })
      .lean();
    res.json({ notes });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

// GET /api/notes/:id/chunks — fetch a range of chunks progressively
router.get('/:id/chunks', auth, async (req, res) => {
  try {
    const noteId = req.params.id;
    const note = await Note.findOne({ _id: noteId, userId: req.userId }).select('_id').lean();
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const startSeq = parseInt(req.query.startSeq) || 0;
    const limit = parseInt(req.query.limit) || 3;

    const chunks = await NoteChunk.find({ noteId: note._id, seq: { $gte: startSeq } })
      .sort({ seq: 1 })
      .limit(limit)
      .lean();

    res.json({ chunks });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch chunks' });
  }
});

// GET /api/notes/:id — note metadata + first 3 chunks
router.get('/:id', auth, async (req, res) => {
  try {
    const note = await Note.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!note) return res.status(404).json({ error: 'Note not found' });

    // Migrate old note formats on the fly
    if (note.blocks && note.blocks.length > 0) {
      await saveChunks(note._id, note.blocks);
      await Note.updateOne({ _id: note._id }, { $unset: { blocks: "" } });
      note.blocks = undefined;
    }

    const chunks = await NoteChunk.find({ noteId: note._id, seq: { $lt: 2 } })
      .sort({ seq: 1 })
      .lean();
    const blocks = chunks.flatMap(c => c.blocks);

    const totalChunks = await NoteChunk.countDocuments({ noteId: note._id });

    res.json({ note: { ...note, blocks, totalChunks } });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch note' });
  }
});

// POST /api/notes — create
router.post('/', auth, async (req, res) => {
  try {
    const note = await Note.create({ userId: req.userId, title: 'Untitled' });
    // seed one empty chunk
    await NoteChunk.create({ noteId: note._id, seq: 0, blocks: [], charCount: 0 });
    res.status(201).json({ note: { ...note.toObject(), blocks: [] } });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create note', detail: e.message });
  }
});

// PATCH /api/notes/:id/chunks — send only dirty chunks (diff-based autosave)
// NOTE: must be defined BEFORE /:id to avoid route conflict
router.patch('/:id/chunks', auth, async (req, res) => {
  try {
    const { title, dirty, deleteFrom } = req.body;
    // dirty: [{seq, blocks}] — only changed/new chunks
    // deleteFrom: number — delete all chunks with seq >= this value

    const update = { updatedAt: new Date() };
    if (title !== undefined) update.title = title;

    const note = await Note.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: update },
      { new: true, select: 'updatedAt' }
    );
    if (!note) return res.status(404).json({ error: 'Note not found' });

    if (Array.isArray(dirty) && dirty.length > 0) {
      const noteObjId = new ObjectId(req.params.id);
      const ops = dirty.map(({ seq, blocks }) => ({
        updateOne: {
          filter: { noteId: noteObjId, seq },
          update: {
            $set: {
              blocks,
              charCount: blocks.reduce((s, b) => s + (b.content || '').length, 0),
            },
          },
          upsert: true,
        },
      }));
      await NoteChunk.bulkWrite(ops);
    }

    if (typeof deleteFrom === 'number') {
      await NoteChunk.deleteMany({ noteId: req.params.id, seq: { $gte: deleteFrom } });
    }

    res.json({ updatedAt: note.updatedAt });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save chunks' });
  }
});

// PATCH /api/notes/:id — autosave (title + blocks, chunked)
router.patch('/:id', auth, async (req, res) => {
  try {
    const { title, blocks } = req.body;
    const update = { updatedAt: new Date() };
    if (title !== undefined) update.title = title;

    const note = await Note.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: update },
      { new: true, select: 'updatedAt' }
    );
    if (!note) return res.status(404).json({ error: 'Note not found' });

    if (Array.isArray(blocks)) await saveChunks(req.params.id, blocks);

    res.json({ updatedAt: note.updatedAt });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save note' });
  }
});

// PUT /api/notes/:id — full overwrite (backward compat)
router.put('/:id', auth, async (req, res) => {
  try {
    const { title, blocks } = req.body;
    const note = await Note.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: { title, updatedAt: new Date() } },
      { new: true }
    );
    if (!note) return res.status(404).json({ error: 'Note not found' });
    if (Array.isArray(blocks)) await saveChunks(note._id, blocks);
    const allBlocks = await loadBlocks(note._id);
    res.json({ note: { ...note.toObject(), blocks: allBlocks } });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save note' });
  }
});

// DELETE /api/notes/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const note = await Note.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (note) await NoteChunk.deleteMany({ noteId: note._id });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// ── Gemini Helper for Note Editing ───────────────────────────────────────────
const gemini = (prompt) => new Promise((resolve, reject) => {
  const key  = process.env.GEMINI_API_KEY;
  if (!key) return reject(new Error('GEMINI_API_KEY is not defined'));
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
  });

  const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', c => { data += c; });
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) resolve(text);
        else reject(new Error(parsed.error?.message || 'No response from Gemini'));
      } catch (e) { reject(e); }
    });
  });
  req.on('error', reject);
  req.write(body);
  req.end();
});

// POST /api/notes/ai — AI Assistant for Formatting & Redefining Note Text
router.post('/ai', auth, async (req, res) => {
  try {
    const { command, text } = req.body;
    if (!command?.trim()) return res.status(400).json({ error: 'command is required' });

    let prompt = '';
    if (command === 'format') {
      prompt = `You are a rich text formatting assistant for a personal note-taking app. 
Your task is to take the following input text and structure it with beautiful HTML elements supported by this application.

Supported elements inside the app:
- Headings: <h1>, <h2>, <h3>, <h4>, <h5>, <h6>
- Standard paragraphs: <p>
- Bullet lists: <ul class="note-list-ul"><li>Item</li></ul>
- Numbered lists: <ol class="note-list-ol"><li>Item</li></ol>
- Code blocks: <pre class="note-code" data-lang="code" contenteditable="false"><span class="note-code-header" contenteditable="false">code ● ● ●</span><code class="note-code-body" contenteditable="true">your code here</code></pre>
- Fact Cards (for highlights, tips, definitions): <div class="note-fact-card" contenteditable="false"><span class="note-fact-emoji">💡</span><div class="note-fact-content" contenteditable="true">Fact description here...</div></div>
- Tables: <table class="note-table"><thead><tr><th>Col 1</th><th>Col 2</th></tr></thead><tbody><tr><td>Cell 1</td><td>Cell 2</td></tr></tbody></table>

Rules:
1. ONLY return the final HTML string containing these tags. Do not wrap it in markdown block code like \`\`\`html.
2. Ensure it is beautifully structured, professional, clear, and perfectly formatted.
3. Keep the original content but improve layout, readability, and organization dramatically.

Here is the input text to format:
"${text}"`;
    } else {
      prompt = `You are an AI assistant inside a note-taking rich text editor.
The user has selected the following text:
"${text}"

The user wants to apply the following action/command:
"${command}"

Respond ONLY with the final HTML content reflecting this action. Use beautiful formatting tags where relevant:
- Headings (<h1> to <h6>)
- Paragraphs (<p>)
- Bullet/Numbered lists (<ul class="note-list-ul"> / <ol class="note-list-ol">)
- Fact Cards: <div class="note-fact-card" contenteditable="false"><span class="note-fact-emoji">💡</span><div class="note-fact-content" contenteditable="true">...</div></div>
- Tables: <table class="note-table">...</table>

Rules:
1. ONLY return the raw formatted HTML string. Do not wrap in markdown \`\`\`html.
2. Be extremely creative and fulfill the user's action perfectly.

Final HTML:`;
    }

    const raw = await gemini(prompt);
    
    let cleaned = raw.trim();
    if (cleaned.startsWith('```html')) {
      cleaned = cleaned.substring(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.substring(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.substring(0, cleaned.length - 3);
    }
    cleaned = cleaned.trim();

    res.json({ html: cleaned });
  } catch (e) {
    console.error('AI Error:', e.message);
    res.status(500).json({ error: 'AI processing failed', detail: e.message });
  }
});

module.exports = router;
