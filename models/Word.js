const mongoose = require('mongoose');

const wordSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  word:       { type: String, required: true, trim: true },
  definition: { type: String, required: true },
  createdAt:  { type: Date, default: Date.now },
});

module.exports = mongoose.model('Word', wordSchema);
