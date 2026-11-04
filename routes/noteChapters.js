const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const Note = require('../models/Note');
const Chapter = require('../models/Chapter');
const NoteChunk = require('../models/NoteChunk');

const router = express.Router({ mergeParams: true });
const TARGET_CHUNK_SIZE = 12000;
const FORMAT_VERSION = 1;

async function findOwnedNote(req) {
  if (!mongoose.isValidObjectId(req.params.noteId)) return null;
  return Note.findOne({
    _id: req.params.noteId,
    userId: req.userId,
  }).select('_id userId title updatedAt').lean();
}

// Existing notes have flat chunks. Give them one General chapter and attach
// those chunks without rewriting their legacy block data.
async function ensureDefaultChapter(noteId) {
  let chapter = await Chapter.findOne({ noteId }).sort({ order: 1, createdAt: 1 });

  if (!chapter) {
    chapter = await Chapter.create({
      noteId,
      title: 'General',
      order: 0,
    });
  }

  await NoteChunk.updateMany(
    {
      noteId,
      $or: [
        { chapterId: { $exists: false } },
        { chapterId: null },
      ],
    },
    { $set: { chapterId: chapter._id } }
  );

  return chapter;
}

function textLength(node) {
  if (!node || typeof node !== 'object') return 0;
  let length = typeof node.text === 'string' ? node.text.length : 0;
  if (Array.isArray(node.content)) {
    for (const child of node.content) length += textLength(child);
  }
  return length;
}

// Split only between top-level ProseMirror nodes. This preserves valid editor
// structure: a paragraph/table/code block is never cut in the middle.
function splitDocumentNodes(nodes) {
  const groups = [];
  let current = [];
  let currentSize = 0;

  for (const node of nodes) {
    const nodeSize = Buffer.byteLength(JSON.stringify(node), 'utf8');
    if (current.length && currentSize + nodeSize > TARGET_CHUNK_SIZE) {
      groups.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(node);
    currentSize += nodeSize;
  }

  if (current.length) groups.push(current);
  if (!groups.length) groups.push([]);
  return groups;
}

const ALLOWED_NODES = new Set([
  'doc', 'paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList',
  'listItem', 'codeBlock', 'horizontalRule', 'hardBreak', 'text', 'table',
  'tableRow', 'tableCell', 'tableHeader', 'image', 'factCard',
]);
const ALLOWED_MARKS = new Set([
  'bold', 'italic', 'strike', 'code', 'underline', 'highlight', 'link', 'textStyle',
]);
const SAFE_FONT_FAMILIES = new Set([
  'Georgia, serif',
  "'Courier New', monospace",
  'Arial, sans-serif',
  'system-ui, sans-serif',
]);

function safeText(value, maxLength = 500) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function safeUrl(value) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || url.length > 2048) return null;
  if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  return null;
}

function safeColor(value) {
  if (typeof value !== 'string') return null;
  const color = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^(rgb|rgba|hsl|hsla)\([0-9.,%\s]+\)$/i.test(color)) return color;
  if (/^[a-z]{3,20}$/i.test(color)) return color;
  return null;
}

function sanitizeDocument(document) {
  const serialized = JSON.stringify(document);
  if (Buffer.byteLength(serialized, 'utf8') > 5 * 1024 * 1024) {
    throw new Error('Chapter content exceeds the 5 MB limit');
  }

  let visited = 0;
  const sanitizeNode = (node, depth = 0, isRoot = false) => {
    visited += 1;
    if (visited > 25000 || depth > 40) {
      throw new Error('Chapter content is too large or deeply nested');
    }
    if (!node || typeof node !== 'object' || !ALLOWED_NODES.has(node.type)) {
      throw new Error('Unsupported editor node in chapter content');
    }

    const clean = { type: node.type };
    const attrs = node.attrs && typeof node.attrs === 'object' ? node.attrs : {};

    if (node.type === 'heading') {
      const level = Number(attrs.level);
      clean.attrs = { level: Number.isInteger(level) && level >= 1 && level <= 6 ? level : 1 };
    } else if (node.type === 'orderedList') {
      const start = Number(attrs.start);
      clean.attrs = { start: Number.isInteger(start) && start > 0 && start <= 9999 ? start : 1 };
    } else if (node.type === 'codeBlock') {
      clean.attrs = { language: safeText(attrs.language, 48).replace(/[^a-z0-9_+#.-]/gi, '') || 'text' };
    } else if (node.type === 'tableCell' || node.type === 'tableHeader') {
      const colspan = Number(attrs.colspan);
      const rowspan = Number(attrs.rowspan);
      const colwidth = Array.isArray(attrs.colwidth)
        ? attrs.colwidth.slice(0, 12).map((value) => Math.max(1, Math.min(2000, Number(value) || 1)))
        : null;
      clean.attrs = {
        colspan: Number.isInteger(colspan) && colspan > 0 && colspan <= 12 ? colspan : 1,
        rowspan: Number.isInteger(rowspan) && rowspan > 0 && rowspan <= 100 ? rowspan : 1,
        colwidth,
      };
    } else if (node.type === 'image') {
      const src = safeUrl(attrs.src);
      if (!src || !/^https?:/i.test(src)) throw new Error('Image URLs must use HTTPS or HTTP');
      const position = ['left', 'right', 'center', 'top'].includes(attrs.position) ? attrs.position : 'center';
      const size = ['small', 'medium', 'large', 'full'].includes(attrs.size) ? attrs.size : 'medium';
      clean.attrs = {
        src,
        alt: safeText(attrs.alt, 300),
        title: safeText(attrs.title, 300),
        position,
        size,
        caption: safeText(attrs.caption, 1000),
      };
    } else if (node.type === 'factCard') {
      clean.attrs = {
        emoji: safeText(attrs.emoji, 12) || '💡',
        color: safeColor(attrs.color),
        fontStyle: ['serif', 'mono', 'italic', 'bold'].includes(attrs.fontStyle) ? attrs.fontStyle : null,
      };
    }

    if (node.type === 'text') {
      if (typeof node.text !== 'string' || node.text.length > 200000) {
        throw new Error('Invalid text node in chapter content');
      }
      clean.text = node.text;
    }

    if (Array.isArray(node.marks)) {
      clean.marks = node.marks.map((mark) => {
        if (!mark || !ALLOWED_MARKS.has(mark.type)) {
          throw new Error('Unsupported text mark in chapter content');
        }
        const nextMark = { type: mark.type };
        const markAttrs = mark.attrs && typeof mark.attrs === 'object' ? mark.attrs : {};
        if (mark.type === 'link') {
          const href = safeUrl(markAttrs.href);
          if (!href) throw new Error('Links must use HTTP, HTTPS, mailto, tel or a relative URL');
          nextMark.attrs = {
            href,
            target: markAttrs.target === '_blank' ? '_blank' : '_self',
            rel: 'noopener noreferrer',
            title: safeText(markAttrs.title, 200),
          };
        } else if (mark.type === 'highlight') {
          const color = safeColor(markAttrs.color);
          nextMark.attrs = color ? { color } : {};
        } else if (mark.type === 'textStyle') {
          const attrs = {};
          const color = safeColor(markAttrs.color);
          if (color) attrs.color = color;
          if (SAFE_FONT_FAMILIES.has(markAttrs.fontFamily)) attrs.fontFamily = markAttrs.fontFamily;
          nextMark.attrs = attrs;
        }
        return nextMark;
      });
    }

    if (Array.isArray(node.content)) {
      clean.content = node.content.map((child) => sanitizeNode(child, depth + 1));
    } else if (['doc', 'paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'table', 'tableRow', 'tableCell', 'tableHeader', 'factCard'].includes(node.type)) {
      clean.content = [];
    }

    if (isRoot && clean.type !== 'doc') throw new Error('Document root must be a doc node');
    return clean;
  };

  return sanitizeNode(document, 0, true);
}
function getChunkCharCount(nodes) {
  return nodes.reduce((sum, node) => sum + textLength(node), 0);
}

router.use(auth);

// GET /api/notes/:noteId/chapters
router.get('/', async (req, res) => {
  try {
    const note = await findOwnedNote(req);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    await ensureDefaultChapter(note._id);

    const [chapters, counts] = await Promise.all([
      Chapter.find({ noteId: note._id })
        .sort({ order: 1, createdAt: 1 })
        .select('title description summary order revision createdAt updatedAt')
        .lean(),
      NoteChunk.aggregate([
        { $match: { noteId: new mongoose.Types.ObjectId(note._id) } },
        { $group: { _id: '$chapterId', chunks: { $sum: 1 }, chars: { $sum: '$charCount' } } },
      ]),
    ]);

    const countMap = new Map(counts.map((item) => [String(item._id), item]));
    res.json({
      chapters: chapters.map((chapter) => {
        const count = countMap.get(String(chapter._id));
        return {
          ...chapter,
          chunkCount: count?.chunks || 0,
          charCount: count?.chars || 0,
        };
      }),
    });
  } catch (error) {
    console.error('List chapters error:', error);
    res.status(500).json({ error: 'Failed to list chapters' });
  }
});

// POST /api/notes/:noteId/chapters
router.post('/', async (req, res) => {
  try {
    const note = await findOwnedNote(req);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title) return res.status(400).json({ error: 'Chapter title is required' });

    await ensureDefaultChapter(note._id);
    const lastChapter = await Chapter.findOne({ noteId: note._id }).sort({ order: -1 });
    const chapter = await Chapter.create({
      noteId: note._id,
      title,
      description: typeof req.body.description === 'string' ? req.body.description : '',
      order: (lastChapter?.order ?? -1) + 1,
    });

    res.status(201).json({ chapter });
  } catch (error) {
    console.error('Create chapter error:', error);
    res.status(500).json({ error: 'Failed to create chapter' });
  }
});

// PATCH /api/notes/:noteId/chapters/reorder
router.patch('/reorder', async (req, res) => {
  try {
    const note = await findOwnedNote(req);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const { chapterIds } = req.body || {};
    if (!Array.isArray(chapterIds) || chapterIds.some((id) => !mongoose.isValidObjectId(id))) {
      return res.status(400).json({ error: 'chapterIds must be an array of chapter IDs' });
    }

    const chapters = await Chapter.find({ noteId: note._id, _id: { $in: chapterIds } })
      .select('_id')
      .lean();
    if (chapters.length !== chapterIds.length) {
      return res.status(400).json({ error: 'Chapter list does not match this note' });
    }

    if (chapterIds.length) {
      await Chapter.bulkWrite(chapterIds.map((id, order) => ({
        updateOne: {
          filter: { _id: id, noteId: note._id },
          update: { $set: { order } },
        },
      })));
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Reorder chapters error:', error);
    res.status(500).json({ error: 'Failed to reorder chapters' });
  }
});

// GET /api/notes/:noteId/chapters/:chapterId/content
router.get('/:chapterId/content', async (req, res) => {
  try {
    const note = await findOwnedNote(req);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const chapter = await Chapter.findOne({
      _id: req.params.chapterId,
      noteId: note._id,
    }).lean();
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

    const chunks = await NoteChunk.find({
      noteId: note._id,
      chapterId: chapter._id,
    }).sort({ seq: 1 }).lean();

    const hasLegacyBlocks = chunks.some((chunk) => chunk.blocks?.length);
    const nodes = chunks.flatMap((chunk) => chunk.nodes || []);
    const response = {
      chapter: {
        _id: chapter._id,
        title: chapter.title,
        order: chapter.order,
        revision: chapter.revision || 0,
      },
      document: hasLegacyBlocks && nodes.length === 0
        ? null
        : { type: 'doc', content: nodes.length ? nodes : [{ type: 'paragraph' }] },
      legacyBlocks: hasLegacyBlocks && nodes.length === 0
        ? chunks.flatMap((chunk) => chunk.blocks || [])
        : undefined,
      chunkCount: chunks.length,
      formatVersion: chunks.reduce(
        (version, chunk) => Math.max(version, chunk.formatVersion || 0),
        0
      ),
      chunks: req.query.view === 'chunks'
        ? chunks.map((chunk) => ({
            _id: chunk._id,
            seq: chunk.seq,
            charCount: chunk.charCount || 0,
            nodes: chunk.nodes || [],
            legacyBlocks: chunk.blocks?.length ? chunk.blocks : undefined,
          }))
        : undefined,
    };

    res.json(response);
  } catch (error) {
    console.error('Get chapter content error:', error);
    res.status(500).json({ error: 'Failed to get chapter content' });
  }
});

// PUT /api/notes/:noteId/chapters/:chapterId/content
router.put('/:chapterId/content', async (req, res) => {
  try {
    const note = await findOwnedNote(req);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const chapter = await Chapter.findOne({
      _id: req.params.chapterId,
      noteId: note._id,
    });
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

    const document = req.body?.document;
    if (!document || document.type !== 'doc' || !Array.isArray(document.content)) {
      return res.status(400).json({ error: 'A valid Tiptap document is required' });
    }

    let sanitizedDocument;
    try {
      sanitizedDocument = sanitizeDocument(document);
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    const expectedRevision = req.body?.revision;
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      return res.status(400).json({
        error: 'revision is required; load the chapter content before saving',
        revision: chapter.revision || 0,
      });
    }

    // Claim this revision atomically before writing chunks. Two saves based on
    // the same revision cannot both proceed and silently overwrite one another.
    const revisionClaim = await Chapter.findOneAndUpdate(
      {
        _id: chapter._id,
        noteId: note._id,
        revision: expectedRevision,
      },
      { $inc: { revision: 1 } },
      { new: true, projection: { revision: 1 } }
    ).lean();

    if (!revisionClaim) {
      const latestChapter = await Chapter.findOne({
        _id: chapter._id,
        noteId: note._id,
      }).select('revision').lean();

      return res.status(409).json({
        error: 'Chapter has changed since it was loaded',
        revision: latestChapter?.revision || 0,
      });
    }

    const savedRevision = revisionClaim.revision;
    const normalizedNodes = sanitizedDocument.content.length ? sanitizedDocument.content : [{ type: 'paragraph' }];
    const groups = splitDocumentNodes(normalizedNodes);
    const oldChunks = await NoteChunk.find({
      noteId: note._id,
      chapterId: chapter._id,
    }).sort({ seq: 1 }).lean();

    const allNoteChunks = await NoteChunk.find({ noteId: note._id })
      .select('seq')
      .sort({ seq: -1 })
      .limit(1)
      .lean();
    let nextSeq = (allNoteChunks[0]?.seq ?? -1) + 1;

    const assignedSeqs = groups.map((_, index) =>
      oldChunks[index]?.seq ?? nextSeq++
    );

    const operations = groups.map((nodes, index) => {
      const oldChunk = oldChunks[index];
      const unchanged = oldChunk &&
        oldChunk.formatVersion === FORMAT_VERSION &&
        JSON.stringify(oldChunk.nodes || []) === JSON.stringify(nodes);

      if (unchanged) return null;

      return {
        updateOne: {
          filter: { noteId: note._id, seq: assignedSeqs[index] },
          update: {
            $set: {
              chapterId: chapter._id,
              nodes,
              blocks: [],
              formatVersion: FORMAT_VERSION,
              charCount: getChunkCharCount(nodes),
            },
          },
          upsert: true,
        },
      };
    }).filter(Boolean);

    if (operations.length) await NoteChunk.bulkWrite(operations);

    const retainedSeqs = assignedSeqs;
    const obsoleteSeqs = oldChunks
      .map((chunk) => chunk.seq)
      .filter((seq) => !retainedSeqs.includes(seq));

    if (obsoleteSeqs.length) {
      await NoteChunk.deleteMany({
        noteId: note._id,
        chapterId: chapter._id,
        seq: { $in: obsoleteSeqs },
      });
    }

    await Note.updateOne({ _id: note._id }, { $set: { updatedAt: new Date() } });

    res.json({
      success: true,
      chapterId: String(chapter._id),
      revision: savedRevision,
      chunkCount: groups.length,
      updatedChunks: operations.length,
      deletedChunks: obsoleteSeqs.length,
    });
  } catch (error) {
    console.error('Save chapter content error:', error);
    res.status(500).json({ error: 'Failed to save chapter content' });
  }
});

// PATCH /api/notes/:noteId/chapters/:chapterId
router.patch('/:chapterId', async (req, res) => {
  try {
    const note = await findOwnedNote(req);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const chapter = await Chapter.findOne({
      _id: req.params.chapterId,
      noteId: note._id,
    });
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

    if (req.body?.title !== undefined) {
      if (typeof req.body.title !== 'string' || !req.body.title.trim()) {
        return res.status(400).json({ error: 'Chapter title cannot be empty' });
      }
      chapter.title = req.body.title.trim();
    }
    if (req.body?.description !== undefined) {
      chapter.description = String(req.body.description);
    }
    if (req.body?.summary !== undefined) {
      chapter.summary = String(req.body.summary);
    }

    await chapter.save();
    res.json({ chapter });
  } catch (error) {
    console.error('Update chapter error:', error);
    res.status(500).json({ error: 'Failed to update chapter' });
  }
});

// DELETE /api/notes/:noteId/chapters/:chapterId
router.delete('/:chapterId', async (req, res) => {
  try {
    const note = await findOwnedNote(req);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const chapters = await Chapter.find({ noteId: note._id }).select('_id').lean();
    if (chapters.length <= 1) {
      return res.status(400).json({ error: 'A note must keep at least one chapter' });
    }

    const chapter = await Chapter.findOne({
      _id: req.params.chapterId,
      noteId: note._id,
    });
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

    await NoteChunk.deleteMany({ noteId: note._id, chapterId: chapter._id });
    await chapter.deleteOne();

    res.json({ success: true });
  } catch (error) {
    console.error('Delete chapter error:', error);
    res.status(500).json({ error: 'Failed to delete chapter' });
  }
});

module.exports = router;
