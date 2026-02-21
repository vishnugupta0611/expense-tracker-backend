const mongoose = require('mongoose');

const spaceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  budgets: {
    monthly: {
      type: Number,
      default: 0,
    },
    categoryBudgets: {
      type: Map,
      of: Number,
      default: {},
    },
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  settledAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Space', spaceSchema);
