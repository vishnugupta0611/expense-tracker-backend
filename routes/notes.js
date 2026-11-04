const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const https    = require('https');
const mongoose = require('mongoose');
const auth     = require('../middleware/auth');
const Note     = require('../models/Note');
const NoteChunk = require('../models/NoteChunk');
const Chapter = require('../models/Chapter');
const Category = require('../models/Category');
const { Types: { ObjectId } } = mongoose;

const CHUNK_CHAR_LIMIT = 4000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

async function categoryBelongsToUser(categoryId, userId) {
  if (categoryId === undefined || categoryId === null || categoryId === '') return true;
  if (!ObjectId.isValid(categoryId)) return false;
  return Boolean(await Category.exists({ _id: categoryId, userId }));
}

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
  const { CLOUDINARY_API_SECRET, CLOUDINARY_API_KEY, CLOUDINARY_CLOUD_NAME } = process.env;
  if (!CLOUDINARY_API_SECRET || !CLOUDINARY_API_KEY || !CLOUDINARY_CLOUD_NAME) {
    throw new Error('Cloudinary is not configured');
  }
  return crypto.createHash('sha1')
    .update(`folder=${folder}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`)
    .digest('hex');
}

function imageMatchesMimeType(buffer, mimeType) {
  if (mimeType === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/gif') return buffer.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/) !== null;
  if (mimeType === 'image/webp') return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
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
    req.setTimeout(30_000, () => req.destroy(new Error('Cloudinary upload timed out')));
    req.on('error', reject);
    req.write(payload, 'utf8');
    req.end();
  });

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/notes/upload-image
router.post('/upload-image', auth, async (req, res) => {
  try {
    const { base64, mimeType } = req.body || {};
    if (typeof base64 !== 'string' || !base64 || typeof mimeType !== 'string') {
      return res.status(400).json({ error: 'base64 and mimeType are required' });
    }
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      return res.status(415).json({ error: 'Unsupported image type' });
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      return res.status(400).json({ error: 'Invalid base64 image data' });
    }
    const imageBuffer = Buffer.from(base64, 'base64');
    if (!imageBuffer.length || imageBuffer.length > MAX_IMAGE_BYTES) {
      return res.status(413).json({ error: 'Image must be smaller than 10 MB' });
    }
    if (!imageMatchesMimeType(imageBuffer, mimeType)) {
      return res.status(400).json({ error: 'Image content does not match mimeType' });
    }
    const url = await uploadToCloudinary(base64, mimeType);
    res.json({ url });
  } catch (e) {
    console.error('Note image upload failed:', e.message);
    res.status(502).json({ error: 'Image upload failed' });
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
    if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'Note not found' });
    const note = await Note.findById(req.params.id).lean();
    if (!note || note.isPublic !== true) return res.status(404).json({ error: 'Note not found' });

    const [chunks, chapters] = await Promise.all([
      NoteChunk.find({ noteId: note._id }).sort({ seq: 1 }).lean(),
      Chapter.find({ noteId: note._id })
        .sort({ order: 1, createdAt: 1 })
        .select('title description summary order revision')
        .lean(),
    ]);

    const blocks = chunks.flatMap((chunk) => chunk.blocks || []);
    const chapterViews = chapters.map((chapter) => {
      const chapterChunks = chunks.filter(
        (chunk) => String(chunk.chapterId) === String(chapter._id)
      );
      const nodes = chapterChunks.flatMap((chunk) => chunk.nodes || []);
      const legacyBlocks = chapterChunks.flatMap((chunk) => chunk.blocks || []);

      return {
        _id: chapter._id,
        title: chapter.title,
        description: chapter.description,
        summary: chapter.summary,
        order: chapter.order,
        document: nodes.length
          ? { type: 'doc', content: nodes }
          : legacyBlocks.length
            ? null
            : { type: 'doc', content: [{ type: 'paragraph' }] },
        legacyBlocks: nodes.length ? undefined : legacyBlocks,
      };
    });

    if (note.blocks?.length && chapterViews.length) {
      const chapterHasContent = chapterViews.some((chapter) =>
        chapter.legacyBlocks?.length ||
        (chapter.document?.content || []).some((node) =>
          node.type !== 'paragraph' || node.content?.length
        )
      );
      if (!chapterHasContent) {
        chapterViews[0].document = null;
        chapterViews[0].legacyBlocks = note.blocks;
      } else {
        const legacyAlreadyIncluded = chapterViews.some((chapter) =>
          JSON.stringify(chapter.legacyBlocks || []) === JSON.stringify(note.blocks)
        );
        if (!legacyAlreadyIncluded) {
          chapterViews.unshift({
            _id: 'legacy-' + String(note._id),
            title: 'Imported legacy content',
            description: '',
            summary: '',
            order: -1,
            document: null,
            legacyBlocks: note.blocks,
          });
        }
      }
    }

    res.json({
      note: {
        ...note,
        blocks,
        chapters: chapterViews,
        totalChunks: chunks.length,
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch note' });
  }
});

// GET /api/notes/public/:id/chunks — read-only progressive chunks
router.get('/public/:id/chunks', async (req, res) => {
  try {
    const noteId = req.params.id;
    const note = await Note.findById(noteId).select('_id isPublic').lean();
    if (!note || note.isPublic !== true) return res.status(404).json({ error: 'Note not found' });

    const startSeq = Number.parseInt(req.query.startSeq ?? '0', 10);
    const requestedLimit = Number.parseInt(req.query.limit ?? '3', 10);
    if (!Number.isInteger(startSeq) || startSeq < 0 || !Number.isInteger(requestedLimit) || requestedLimit < 1) {
      return res.status(400).json({ error: 'startSeq must be non-negative and limit must be a positive integer' });
    }
    const limit = Math.min(requestedLimit, 20);

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
    const { categoryId, search, project, tag } = req.query;
    const filter = { userId: req.userId };
    if (categoryId) filter.categoryId = categoryId;
    if (project) filter.project = project;
    if (tag) filter.tags = tag;
    if (search) {
      filter.$text = { $search: search };
    }

    const notes = await Note.find(filter)
      .select('title categoryId summary project tags sourceProvider sourceUrl personalNotes isPublic updatedAt createdAt')
      .populate('categoryId', 'name isDefault')
      .sort(search ? { score: { $meta: 'textScore' } } : { updatedAt: -1 })
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

    const startSeq = Number.parseInt(req.query.startSeq ?? '0', 10);
    const requestedLimit = Number.parseInt(req.query.limit ?? '3', 10);
    if (!Number.isInteger(startSeq) || startSeq < 0 || !Number.isInteger(requestedLimit) || requestedLimit < 1) {
      return res.status(400).json({ error: 'startSeq must be non-negative and limit must be a positive integer' });
    }
    const limit = Math.min(requestedLimit, 20);

    const chunks = await NoteChunk.find({ noteId: note._id, seq: { $gte: startSeq } })
      .sort({ seq: 1 })
      .limit(limit)
      .lean();

    res.json({ chunks });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch chunks' });
  }
});

// PATCH /api/notes/:id/public — explicitly publish or unpublish a note.
router.patch('/:id/public', auth, async (req, res) => {
  try {
    if (typeof req.body?.isPublic !== 'boolean') {
      return res.status(400).json({ error: 'isPublic must be a boolean' });
    }
    const note = await Note.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: { isPublic: req.body.isPublic, updatedAt: new Date() } },
      { new: true, select: '_id isPublic updatedAt' }
    ).lean();
    if (!note) return res.status(404).json({ error: 'Note not found' });
    res.json({ note });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update note visibility' });
  }
});

// GET /api/notes/:id — note metadata + chunks (first chunks by default, or all chunks when ?full=1)
// GET /api/notes/:id/meta — lightweight note metadata for the chapter workspace
router.get('/:id/meta', auth, async (req, res) => {
  try {
    const note = await Note.findOne({ _id: req.params.id, userId: req.userId })
      .populate('categoryId', 'name isDefault')
      .select('title categoryId summary project tags sourceProvider sourceUrl personalNotes isPublic createdAt updatedAt')
      .lean();
    if (!note) return res.status(404).json({ error: 'Note not found' });
    res.json({ note });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch note metadata' });
  }
});
router.get('/:id', auth, async (req, res) => {
  try {
    const note = await Note.findOne({ _id: req.params.id, userId: req.userId })
      .populate('categoryId', 'name isDefault')
      .lean();
    if (!note) return res.status(404).json({ error: 'Note not found' });

    // Migrate old note formats on the fly
    if (note.blocks && note.blocks.length > 0 && !(await Chapter.exists({ noteId: note._id }))) {
      await saveChunks(note._id, note.blocks);
      await Note.updateOne({ _id: note._id }, { $unset: { blocks: "" } });
      note.blocks = undefined;
    }

    // Load all chunks so complete note is loaded immediately without glitches or missing blocks
    const chunks = await NoteChunk.find({ noteId: note._id })
      .sort({ seq: 1 })
      .lean();
    const storedBlocks = chunks.flatMap(c => c.blocks || []);
    const blocks = storedBlocks.length ? storedBlocks : (note.blocks || []);

    res.json({ note: { ...note, blocks, totalChunks: chunks.length } });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch note' });
  }
});

// POST /api/notes — create
router.post('/', auth, async (req, res) => {
  try {
    const {
      title,
      categoryId,
      summary,
      project,
      tags,
      sourceProvider,
      sourceUrl,
      personalNotes,
      blocks,
    } = req.body || {};

    if (!(await categoryBelongsToUser(categoryId, req.userId))) {
      return res.status(400).json({ error: 'Invalid category for this user' });
    }

    const note = await Note.create({
      userId: req.userId,
      title: title || 'Untitled',
      categoryId: categoryId || null,
      summary: summary || '',
      project: project || '',
      tags: Array.isArray(tags) ? tags : [],
      sourceProvider: sourceProvider || '',
      sourceUrl: sourceUrl || '',
      personalNotes: personalNotes || '',
    });

    if (Array.isArray(blocks) && blocks.length > 0) {
      await saveChunks(note._id, blocks);
    } else {
      // seed one empty chunk
      await NoteChunk.create({ noteId: note._id, seq: 0, blocks: [], charCount: 0 });
    }

    const allBlocks = await loadBlocks(note._id);
    res.status(201).json({ note: { ...note.toObject(), blocks: allBlocks } });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create note', detail: e.message });
  }
});

// PATCH /api/notes/:id/chunks — send only dirty chunks (diff-based autosave)
// NOTE: must be defined BEFORE /:id to avoid route conflict
router.patch('/:id/chunks', auth, async (req, res) => {
  try {
    if (await Chapter.exists({ noteId: req.params.id })) {
      return res.status(409).json({
        error: 'This note uses chapter-based content. Open the chapter editor to edit its content.',
      });
    }

    const {
      title,
      categoryId,
      summary,
      project,
      tags,
      sourceProvider,
      sourceUrl,
      personalNotes,
      dirty,
      deleteFrom,
    } = req.body;

    if (categoryId !== undefined && !(await categoryBelongsToUser(categoryId, req.userId))) {
      return res.status(400).json({ error: 'Invalid category for this user' });
    }

    const update = { updatedAt: new Date() };
    if (title !== undefined) update.title = title;
    if (categoryId !== undefined) update.categoryId = categoryId || null;
    if (summary !== undefined) update.summary = summary;
    if (project !== undefined) update.project = project;
    if (tags !== undefined) update.tags = Array.isArray(tags) ? tags : [];
    if (sourceProvider !== undefined) update.sourceProvider = sourceProvider;
    if (sourceUrl !== undefined) update.sourceUrl = sourceUrl;
    if (personalNotes !== undefined) update.personalNotes = personalNotes;

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

// PATCH /api/notes/:id — autosave (title + metadata + blocks, chunked)
router.patch('/:id', auth, async (req, res) => {
  try {
    if (Array.isArray(req.body?.blocks) && await Chapter.exists({ noteId: req.params.id })) {
      return res.status(409).json({
        error: 'This note uses chapter-based content. Open the chapter editor to edit its content.',
      });
    }

    const {
      title,
      categoryId,
      summary,
      project,
      tags,
      sourceProvider,
      sourceUrl,
      personalNotes,
      blocks,
    } = req.body;

    if (categoryId !== undefined && !(await categoryBelongsToUser(categoryId, req.userId))) {
      return res.status(400).json({ error: 'Invalid category for this user' });
    }

    const update = { updatedAt: new Date() };
    if (title !== undefined) update.title = title;
    if (categoryId !== undefined) update.categoryId = categoryId || null;
    if (summary !== undefined) update.summary = summary;
    if (project !== undefined) update.project = project;
    if (tags !== undefined) update.tags = Array.isArray(tags) ? tags : [];
    if (sourceProvider !== undefined) update.sourceProvider = sourceProvider;
    if (sourceUrl !== undefined) update.sourceUrl = sourceUrl;
    if (personalNotes !== undefined) update.personalNotes = personalNotes;

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
    if (Array.isArray(req.body?.blocks) && await Chapter.exists({ noteId: req.params.id })) {
      return res.status(409).json({
        error: 'This note uses chapter-based content. Open the chapter editor to edit its content.',
      });
    }

    const {
      title,
      categoryId,
      summary,
      project,
      tags,
      sourceProvider,
      sourceUrl,
      personalNotes,
      blocks,
    } = req.body;

    if (categoryId !== undefined && !(await categoryBelongsToUser(categoryId, req.userId))) {
      return res.status(400).json({ error: 'Invalid category for this user' });
    }

    const update = { updatedAt: new Date() };
    if (title !== undefined) update.title = title;
    if (categoryId !== undefined) update.categoryId = categoryId || null;
    if (summary !== undefined) update.summary = summary;
    if (project !== undefined) update.project = project;
    if (tags !== undefined) update.tags = Array.isArray(tags) ? tags : [];
    if (sourceProvider !== undefined) update.sourceProvider = sourceProvider;
    if (sourceUrl !== undefined) update.sourceUrl = sourceUrl;
    if (personalNotes !== undefined) update.personalNotes = personalNotes;

    const note = await Note.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: update },
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
    if (note) {
      await Promise.all([
        NoteChunk.deleteMany({ noteId: note._id }),
        Chapter.deleteMany({ noteId: note._id }),
      ]);
    }
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
