const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  commentId: {
    type: String,
    required: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  text: {
    type: String,
    required: true,
    trim: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, {
  _id: false,
});

const likeSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, {
  _id: false,
});

const familyPostSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true,
    trim: true,
  },
  //image will be an array of strings (URLs) to support multiple images per post
  frameType: {
    type: String,
    enum: ['square', 'portrait', 'fit'],
    default: 'square',
  },
  image: {
    type: [String],
    required: true,
  },
  familyKey: {
    type: String,
    required: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  comments: {
    type: [commentSchema],
    default: [],
  },
  likes: {
    type: [likeSchema],
    default: [],
  },
}, {
  timestamps: true,
});

familyPostSchema.index({ familyKey: 1, createdAt: -1 });

module.exports = mongoose.model('FamilyPost', familyPostSchema);
