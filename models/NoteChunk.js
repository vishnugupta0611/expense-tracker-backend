const mongoose = require('mongoose');

const blockSchema = new mongoose.Schema({
  type:      { type: String, enum: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'text', 'image', 'code', 'divider', 'ul', 'ol', 'fact', 'table'], required: true },
  content:   { type: String, default: '' },
  color:     { type: String, default: '' },
  fontStyle: { type: String, default: '' },
}, { _id: false });

// One chunk = up to ~4000 chars of block content
const noteChunkSchema = new mongoose.Schema({
  noteId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Note', required: true, index: true },
  seq:       { type: Number, required: true },   // 0, 1, 2 ...
  blocks:    { type: [blockSchema], default: [] },
  charCount: { type: Number, default: 0 },       // cached sum of content lengths
}, { timestamps: false });

// Compound unique index: one chunk per (noteId, seq)
noteChunkSchema.index({ noteId: 1, seq: 1 }, { unique: true });

module.exports = mongoose.model('NoteChunk', noteChunkSchema);
