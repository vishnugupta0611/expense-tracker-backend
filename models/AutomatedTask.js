const mongoose = require('mongoose');

const automatedTaskSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  type: {
    type: String,
    enum: ['apply', 'message', 'search'],
    required: true,
  },
  time: {
    type: String, // format: "HH:MM", e.g., "09:30"
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  data: {
    // For 'message': phone, messageText
    // For 'search': query
    // For 'apply': empty or filter settings
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('AutomatedTask', automatedTaskSchema);
