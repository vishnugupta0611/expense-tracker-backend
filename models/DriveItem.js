const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const driveItemSchema = new mongoose.Schema({
  ownerId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  members:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  name:         { type: String, required: true },
  type:         { type: String, enum: ['folder', 'file'], required: true },
  parentId:     { type: mongoose.Schema.Types.ObjectId, ref: 'DriveItem', default: null },
  // file-only
  url:          { type: String, default: '' },
  mimeType:     { type: String, default: '' },
  size:         { type: Number, default: 0 },
  publicId:     { type: String, default: '' },
  // folder lock
  isLocked:     { type: Boolean, default: false },
  passwordHash: { type: String, default: '' },
  createdAt:    { type: Date, default: Date.now },
  updatedAt:    { type: Date, default: Date.now },
});

// Helper to hash password
driveItemSchema.methods.setPassword = async function (plain) {
  this.passwordHash = await bcrypt.hash(plain, 10);
  this.isLocked = true;
};

driveItemSchema.methods.checkPassword = async function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

module.exports = mongoose.model('DriveItem', driveItemSchema);
