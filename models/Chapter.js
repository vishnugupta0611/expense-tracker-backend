const mongoose = require('mongoose');

const chapterSchema = new mongoose.Schema({
  noteId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Note',
    required: true,
    index: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
    default: 'General',
  },
  description: {
    type: String,
    default: '',
  },
  order: {
    type: Number,
    default: 0,
  },
  summary: {
    type: String,
    default: '',
  },
  revision: {
    type: Number,
    default: 0,
  },
  // Short-lived write lock prevents a second editor from reading a new
  // revision while the corresponding chunk write is still in progress.
  writeLock: {
    type: Boolean,
    default: false,
  },
  writeLockAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

chapterSchema.index({ noteId: 1, order: 1 });
chapterSchema.index({ noteId: 1, title: 1 });

module.exports = mongoose.model('Chapter', chapterSchema);
