const crypto = require('crypto');
const Family = require('../models/Family');
const User = require('../models/User');

const buildUsernameEmail = (username) => `${username.trim().toLowerCase().replace(/\s+/g, '_')}@spendly.app`;

const createFamilyKey = () => `family_${crypto.randomBytes(6).toString('hex')}`;

const createFamilyLink = async (req, res) => {
  try {
    console.log("hello")
    const { name } = req.body;

    if (req.user.familyKey) {
      const existingFamily = await Family.findOne({ familyKey: req.user.familyKey })
        .populate('members', 'name email avatar familyKey');

      return res.status(400).json({
        error: 'User already has a family',
        family: existingFamily,
        familyKey: req.user.familyKey,
      });
    }

    let familyKey;
    let exists = true;

    while (exists) {
      familyKey = createFamilyKey();
      exists = await Family.exists({ familyKey });
    }

    const family = new Family({
      familyKey,
      name: name || 'My Family',
      createdBy: req.userId,
      members: [req.userId],
    });

    await family.save();

    req.user.familyKey = familyKey;
    await req.user.save();

    await family.populate('members', 'name email avatar familyKey');

    res.status(201).json({
      message: 'Family link created successfully',
      familyKey,
      family,
    });
  } catch (error) {
    console.error('Create family link error:', error);
    res.status(500).json({ error: 'Failed to create family link' });
  }
};




const addPersonToFamily = async (req, res) => {
  try {
    const { username } = req.body;
    const { familyKey } = req.params;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const family = await Family.findOne({ familyKey });

    if (!family) {
      return res.status(404).json({ error: 'Family not found' });
    }

    if (family.createdBy.toString() !== req.userId.toString()) {
      return res.status(403).json({ error: 'Only family creator can add members' });
    }

    const userToAdd = await User.findOne({ email: buildUsernameEmail(username) });

    if (!userToAdd) {
      return res.status(404).json({ error: 'User not found with this username' });
    }

    if (userToAdd.familyKey && userToAdd.familyKey !== familyKey) {
      return res.status(400).json({ error: 'User already belongs to another family' });
    }

    if (!family.members.some(memberId => memberId.toString() === userToAdd._id.toString())) {
      family.members.push(userToAdd._id);
    }

    userToAdd.familyKey = familyKey;

    await Promise.all([family.save(), userToAdd.save()]);
    await family.populate('members', 'name email avatar familyKey');

    res.json({
      message: 'User added to family successfully',
      familyKey,
      family,
    });
  } catch (error) {
    console.error('Add person to family error:', error);
    res.status(500).json({ error: 'Failed to add person to family' });
  }
};

const getFamilyMembers = async (req, res) => {
  try {
    const { familyKey } = req.params;

    if (!familyKey) {
      return res.status(400).json({ error: 'Family key is required' });
    }

    const family = await Family.findOne({ familyKey }).populate('members', 'name email avatar');

    if (!family) {
      return res.status(404).json({ error: 'Family not found' });
    }

    res.json({
      familyKey,
      members: family.members || [],
    });
  } catch (error) {
    console.error('Get family members error:', error);
    res.status(500).json({ error: 'Failed to get family members' });
  }
};

module.exports = {
  createFamilyLink,
  addPersonToFamily,
  getFamilyMembers,
};
