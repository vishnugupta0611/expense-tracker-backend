const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  category: {
    type: String,
    required: true,
    default: 'Other',
  },
  date: {
    type: Date,
    default: Date.now,
  },
  type: {
    type: String,
    default: 'personal',
  },
  description: {
    type: String,
  },
}, {
  timestamps: true,
});

// Index for faster queries
expenseSchema.index({ userId: 1, date: -1 });

module.exports = mongoose.model('Expense', expenseSchema);

