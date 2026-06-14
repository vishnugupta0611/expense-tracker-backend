const mongoose = require('mongoose');

const jobHistorySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  searchType: {
    type: String,
    enum: ['url', 'term'],
    required: true,
  },
  query: {
    type: String,
    required: true,
  },
  resultsCount: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('JobHistory', jobHistorySchema);
