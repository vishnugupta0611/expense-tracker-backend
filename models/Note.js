const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, default: 'Untitled' },
  blocks: {
    type: [
      {
        type: { type: String, enum: ['h1', 'h2', 'text', 'image', 'code', 'divider'], required: true },
        content: { type: String, default: '' },
        color: { type: String, default: '' },       // hex color e.g. "#e74c3c"
        fontStyle: { type: String, default: '' },   // e.g. "serif", "mono", "italic"
      }
    ],
    default: [],
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Note', noteSchema);
