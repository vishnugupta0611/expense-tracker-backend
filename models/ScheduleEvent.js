const mongoose = require('mongoose');

const scheduleEventSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  startTime: {
    type: String,
    required: true, // e.g. "07:00"
  },
  endTime: {
    type: String,
    default: '', // optional
  },
  category: {
    type: String,
    required: true,
    enum: ['work', 'health', 'shopping', 'study', 'personal'],
    default: 'personal',
  },
  days: {
    type: [String],
    enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    default: [],
  },
  specialDate: {
    type: Date,
    default: null,
  },
  notes: {
    type: String,
    trim: true,
    default: '',
  },
  reminder: {
    type: Boolean,
    default: false,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, {
  timestamps: true,
});

// Indexes for efficient queries
scheduleEventSchema.index({ userId: 1, days: 1 });
scheduleEventSchema.index({ userId: 1, specialDate: 1 });

module.exports = mongoose.model('ScheduleEvent', scheduleEventSchema);
