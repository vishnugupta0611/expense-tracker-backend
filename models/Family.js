const mongoose = require('mongoose');

const familySchema = new mongoose.Schema({
  familyKey: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  name: {
    type: String,
    default: 'My Family',
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
}, {
  timestamps: true,
});

module.exports = mongoose.model('Family', familySchema);
