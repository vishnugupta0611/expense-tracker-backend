const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const FamilyMessage = require('../models/FamilyMessage');
const User = require('../models/User');
const { notifyFamily } = require('../services/familyNotificationService');
const {
  createFamilyLink,
  addPersonToFamily,
  getFamilyMembers,
} = require('../controllers/familyController');

// A token belongs to the account currently signed in on this device.
router.post('/device-token', auth, async (req, res) => {
  const token = req.body?.fcmtoken;
  if (typeof token !== 'string' || !token.trim() || token !== token.trim() || token.length > 4096) {
    return res.status(400).json({ error: 'Invalid device token' });
  }
  try {
    await User.updateMany({ _id: { $ne: req.userId }, fcmtoken: token }, { $unset: { fcmtoken: 1 } });
    await User.updateOne({ _id: req.userId }, { $set: { fcmtoken: token } });
    return res.json({ message: 'Device registered' });
  } catch (_) {
    return res.status(500).json({ error: 'Device registration failed' });
  }
});

router.post('/create-family-link', auth, createFamilyLink);
router.post('/:familyKey/add-person', auth, addPersonToFamily);
router.get('/:familyKey/members', auth, getFamilyMembers);

router.get('/:familyKey/messages', auth, async (req, res) => {
  if (req.user.familyKey !== req.params.familyKey) return res.status(403).json({ error: 'Not a family member' });
  try {
    const messages = await FamilyMessage.find({ familyKey: req.params.familyKey }).sort({ createdAt: -1 }).limit(100).populate('userId', 'name avatar').lean();
    res.json({ messages: messages.reverse() });
  } catch (error) { res.status(500).json({ error: 'Failed to load messages' }); }
});

router.post('/:familyKey/messages', auth, async (req, res) => {
  if (req.user.familyKey !== req.params.familyKey) return res.status(403).json({ error: 'Not a family member' });
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  if (!text || text.length > 2000) return res.status(400).json({ error: 'Message must be between 1 and 2000 characters' });
  try {
    const message = await FamilyMessage.create({ familyKey: req.params.familyKey, userId: req.userId, text });
    await message.populate('userId', 'name avatar');
    res.status(201).json({ message });
    notifyFamily({ familyKey: req.params.familyKey, actorId: req.userId,
      title: `${req.user.name || 'Family'} sent a message`, body: text,
      type: 'family_message', itemId: message._id }).catch(() => {
      console.warn('Family message notification could not be delivered');
    });
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ error: 'Failed to send message' });
    else console.error('Message notification failed:', error.message);
  }
});

module.exports = router;
