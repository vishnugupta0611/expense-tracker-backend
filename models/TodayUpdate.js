const mongoose = require('mongoose');

// One bounded document per owner and India calendar day keeps content and quota atomic.
const updateSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  day: { type: String, required: true },
  wordCount: { type: Number, required: true, default: 0 },
  entries: [{ document: mongoose.Schema.Types.Mixed, noteId: mongoose.Schema.Types.ObjectId, chapterId: mongoose.Schema.Types.ObjectId, wordCount: Number, createdAt: Date, _id: false }],
}, { timestamps: true });
updateSchema.index({ userId: 1, day: 1 }, { unique: true });
module.exports = mongoose.model('TodayUpdate', updateSchema);
