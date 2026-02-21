const mongoose = require('mongoose');

const shoppingItemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  category: {
    type: String,
    required: true,
    enum: ['groceries', 'household', 'personal', 'electronics', 'clothing', 'other'],
    default: 'groceries',
  },
  completed: {
    type: Boolean,
    default: false,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium',
  },
  notes: {
    type: String,
    trim: true,
  },
  estimatedPrice: {
    type: Number,
    min: 0,
  },
  quantity: {
    type: Number,
    default: 1,
    min: 1,
  },
  unit: {
    type: String,
    default: 'piece',
  },
}, {
  timestamps: true,
});

// Index for efficient queries
shoppingItemSchema.index({ userId: 1, completed: 1 });
shoppingItemSchema.index({ userId: 1, category: 1 });

module.exports = mongoose.model('ShoppingItem', shoppingItemSchema);