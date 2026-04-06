const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Wallet = require('../models/Wallet');

// Helper — get or create wallet
const getWallet = async (userId) => {
  let wallet = await Wallet.findOne({ userId });
  if (!wallet) wallet = await Wallet.create({ userId, balance: 0, lent: [], borrowed: [] });
  return wallet;
};

// GET /api/wallet
router.get('/', auth, async (req, res) => {
  try {
    const wallet = await getWallet(req.userId);
    res.json(wallet);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch wallet' });
  }
});

// PUT /api/wallet/balance  — set total balance
router.put('/balance', auth, async (req, res) => {
  try {
    const { balance } = req.body;
    if (balance === undefined || isNaN(balance)) return res.status(400).json({ error: 'Invalid balance' });
    const wallet = await Wallet.findOneAndUpdate(
      { userId: req.userId },
      { $set: { balance: parseFloat(balance) } },
      { new: true, upsert: true }
    );
    res.json(wallet);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update balance' });
  }
});

// POST /api/wallet/lent  — add lend entry
router.post('/lent', auth, async (req, res) => {
  try {
    const { name, amount, note } = req.body;
    if (!name || !amount) return res.status(400).json({ error: 'name and amount required' });
    const wallet = await Wallet.findOneAndUpdate(
      { userId: req.userId },
      { $push: { lent: { name, amount: parseFloat(amount), note } } },
      { new: true, upsert: true }
    );
    res.json(wallet);
  } catch (e) {
    res.status(500).json({ error: 'Failed to add lent entry' });
  }
});

// DELETE /api/wallet/lent/:id
router.delete('/lent/:id', auth, async (req, res) => {
  try {
    const wallet = await Wallet.findOneAndUpdate(
      { userId: req.userId },
      { $pull: { lent: { _id: req.params.id } } },
      { new: true }
    );
    res.json(wallet);
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete lent entry' });
  }
});

// POST /api/wallet/borrowed  — add borrow entry
router.post('/borrowed', auth, async (req, res) => {
  try {
    const { name, amount, note } = req.body;
    if (!name || !amount) return res.status(400).json({ error: 'name and amount required' });
    const wallet = await Wallet.findOneAndUpdate(
      { userId: req.userId },
      { $push: { borrowed: { name, amount: parseFloat(amount), note } } },
      { new: true, upsert: true }
    );
    res.json(wallet);
  } catch (e) {
    res.status(500).json({ error: 'Failed to add borrowed entry' });
  }
});

// DELETE /api/wallet/borrowed/:id
router.delete('/borrowed/:id', auth, async (req, res) => {
  try {
    const wallet = await Wallet.findOneAndUpdate(
      { userId: req.userId },
      { $pull: { borrowed: { _id: req.params.id } } },
      { new: true }
    );
    res.json(wallet);
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete borrowed entry' });
  }
});

module.exports = router;
