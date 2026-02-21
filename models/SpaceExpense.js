const mongoose = require('mongoose');

const spaceExpenseSchema = new mongoose.Schema({
  spaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Space',
    required: true,
  },
  paidBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  splitBetween: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
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
  description: {
    type: String,
  },
  comments: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  }],
}, {
  timestamps: true,
});

// Index for faster queries
spaceExpenseSchema.index({ spaceId: 1, date: -1 });

module.exports = mongoose.model('SpaceExpense', spaceExpenseSchema);
