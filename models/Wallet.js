const mongoose = require('mongoose');

const entrySchema = new mongoose.Schema({
  name: { type: String, required: true },
  amount: { type: Number, required: true },
  note: { type: String, default: '' },
  date: { type: Date, default: Date.now },
});

const walletSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  balance: { type: Number, default: 0 },
  lent: [entrySchema],    // money given to others
  borrowed: [entrySchema], // money taken from others
}, { timestamps: true });

module.exports = mongoose.model('Wallet', walletSchema);
