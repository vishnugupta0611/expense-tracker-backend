const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  clerkId: {
    type: String,
    sparse: true,
    index: true,
  },
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
  password: {
    type: String,
    default: null,
  },
  googleId: {
    type: String,
    sparse: true,
  },
  avatar: {
    type: String,
    default: '',
  },
  familyKey: {
    type: String,
    default: '',
    index: true,
  },
  defaultView: {
    type: String,
    default: 'family',
  },
  telegramId: {
    type: String,
  },
  fcmtoken: {
    type: String,
  },
  budgets: {
    daily:   { type: Number, default: 0 },
    monthly: { type: Number, default: 0 },
    categoryBudgets: { type: Map, of: Number, default: {} },
  },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
