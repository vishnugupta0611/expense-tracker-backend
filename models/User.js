const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },
  googleId: {
    type: String,
    sparse: true,
  },
  avatar: {
    type: String,
    default: '',
  },
  defaultView: {
    type: String,
    default: 'expenses', // 'expenses', 'spaces', or specific spaceId
  },
  telegramId: {
    type: String,
  },
  budgets: {
    daily: {
      type: Number,
      default: 0,
    },
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
}, {
  timestamps: true,
});

module.exports = mongoose.model('User', userSchema);
