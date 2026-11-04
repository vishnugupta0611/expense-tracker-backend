const mongoose = require('mongoose');

const blockSchema = new mongoose.Schema({
  type:      { type: String, enum: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'text', 'image', 'code', 'divider', 'ul', 'ol', 'fact', 'table'], required: true },
  content:   { type: String, default: '' },
  color:     { type: String, default: '' },
  fontStyle: { type: String, default: '' },
  position:  { type: String },
  size:      { type: String },
  caption:   { type: String },
  alt:       { type: String },
}, { _id: false });

// Legacy notes continue using blocks. New Tiptap chapters store complete top-level
// ProseMirror nodes in nodes, keeping both formats readable during migration.
const noteChunkSchema = new mongoose.Schema({
  noteId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Note', required: true, index: true },
  chapterId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', index: true },
  seq:           { type: Number, required: true },
  blocks:        { type: [blockSchema], default: [] },
  nodes:         { type: [mongoose.Schema.Types.Mixed], default: [] },
  formatVersion: { type: Number, default: 0 },
  charCount:     { type: Number, default: 0 },
}, { timestamps: false });

// Keep the existing note-wide sequence constraint so old chunk APIs remain valid.
// Chapter chunks use the same sequence space; chapterId is an additional lookup key.
noteChunkSchema.index({ noteId: 1, seq: 1 }, { unique: true });
noteChunkSchema.index({ noteId: 1, chapterId: 1, seq: 1 });

module.exports = mongoose.model('NoteChunk', noteChunkSchema);
