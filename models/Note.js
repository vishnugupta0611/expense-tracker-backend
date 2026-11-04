const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
  userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title:          { type: String, default: 'Untitled' },

  // Optional enhanced fields — existing notes without these remain completely valid
  categoryId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
  summary:        { type: String, default: '' },
  project:        { type: String, default: '', trim: true },
  tags:           { type: [String], default: [] },
  sourceProvider: { type: String, default: '' },
  sourceUrl:      { type: String, default: '' },
  personalNotes:  { type: String, default: '' },
  isPublic:       { type: Boolean, default: false, index: true },

  createdAt:      { type: Date, default: Date.now },
  updatedAt:      { type: Date, default: Date.now },
  // Monotonic note-wide sequence allocator for chapter chunks.
  chunkSeqCounter: { type: Number, default: -1 },
});

// Indexes for fast category filtering, tag search, and text search
noteSchema.index({ userId: 1, categoryId: 1 });
noteSchema.index({ userId: 1, updatedAt: -1 });
noteSchema.index({ title: 'text', summary: 'text', tags: 'text', project: 'text' });

module.exports = mongoose.model('Note', noteSchema);
