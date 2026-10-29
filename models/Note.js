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

  createdAt:      { type: Date, default: Date.now },
  updatedAt:      { type: Date, default: Date.now },
});

// Indexes for fast category filtering, tag search, and text search
noteSchema.index({ userId: 1, categoryId: 1 });
noteSchema.index({ userId: 1, updatedAt: -1 });
noteSchema.index({ title: 'text', summary: 'text', tags: 'text', project: 'text' });

module.exports = mongoose.model('Note', noteSchema);
