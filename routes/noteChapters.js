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
    { noteId, chapterId: { $exists: false } },
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
    if (
      !document ||
      document.type !== 'doc' ||
      !Array.isArray(document.content) ||
      document.content.some((node) => !node || typeof node !== 'object' || typeof node.type !== 'string')
    ) {
      return res.status(400).json({ error: 'A valid Tiptap document is required' });
    }

    const expectedRevision = req.body?.revision;
    if (
      Number.isInteger(expectedRevision) &&
      expectedRevision !== (chapter.revision || 0)
    ) {
      return res.status(409).json({
        error: 'Chapter has changed since it was loaded',
        revision: chapter.revision || 0,
      });
    }

    const normalizedNodes = document.content.length ? document.content : [{ type: 'paragraph' }];
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

    chapter.revision = (chapter.revision || 0) + 1;
    await chapter.save();
    await Note.updateOne({ _id: note._id }, { $set: { updatedAt: new Date() } });

    res.json({
      success: true,
      chapterId: String(chapter._id),
      revision: chapter.revision,
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
