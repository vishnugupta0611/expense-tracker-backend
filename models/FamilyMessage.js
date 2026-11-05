const mongoose = require('mongoose');

const familyMessageSchema = new mongoose.Schema({
  familyKey: { type: String, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, trim: true, maxlength: 2000 },
}, { timestamps: true });
familyMessageSchema.index({ familyKey: 1, createdAt: -1 });
module.exports = mongoose.model('FamilyMessage', familyMessageSchema);
