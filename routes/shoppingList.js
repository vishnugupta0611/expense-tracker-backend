const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ShoppingItem = require('../models/ShoppingItem');
const Family = require('../models/Family');
const mongoose = require('mongoose');

async function familyFor(req) {
  if (!req.user.familyKey) return null;
  return Family.findOne({ familyKey: req.user.familyKey, members: req.userId }).lean();
}
const populated = query => query.populate('userId', 'name avatar').populate('assignedTo', 'name avatar').populate('assignedBy', 'name avatar');
router.get('/family', auth, async (req, res) => {
  try { const family = await familyFor(req); if (!family) return res.status(403).json({ error: 'Join a family to see shared tasks' });
    res.json(await populated(ShoppingItem.find({ familyKey: family.familyKey }).sort({ createdAt: -1 })).lean());
  } catch (error) { res.status(500).json({ error: 'Could not load family tasks' }); }
});
router.post('/family', auth, async (req, res) => {
  try {
    const family = await familyFor(req); if (!family) return res.status(403).json({ error: 'Join a family to add shared tasks' });
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 200) return res.status(400).json({ error: 'Enter a task name (up to 200 characters)' });
    const assignee = req.body.assignedTo || null;
    if (assignee && (!mongoose.isValidObjectId(assignee) || !family.members.some(id => String(id) === String(assignee)))) return res.status(400).json({ error: 'Choose a current family member' });
    const item = await ShoppingItem.create({ name, category: req.body.category || 'groceries', familyKey: family.familyKey, userId: req.userId, assignedTo: assignee, assignedBy: assignee ? req.userId : null });
    res.status(201).json(await populated(ShoppingItem.findById(item._id)).lean());
  } catch (error) { res.status(400).json({ error: 'Could not add task. Check the details and try again.' }); }
});
router.put('/family/:id', auth, async (req, res) => {
  try {
    const family = await familyFor(req); if (!family) return res.status(403).json({ error: 'Not a family member' });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid task' });
    const item = await ShoppingItem.findOne({ _id: req.params.id, familyKey: family.familyKey });
    if (!item) return res.status(404).json({ error: 'Task not found' });
    if (req.body.assignedTo !== undefined) {
      const id = req.body.assignedTo;
      if (id !== null && (!mongoose.isValidObjectId(id) || !family.members.some(member => String(member) === String(id)))) return res.status(400).json({ error: 'Choose a current family member' });
      item.assignedTo = id; item.assignedBy = id ? req.userId : null;
    }
    if (req.body.completed !== undefined) { if (typeof req.body.completed !== 'boolean') return res.status(400).json({ error: 'Invalid completion status' }); item.completed = req.body.completed; }
    await item.save(); res.json(await populated(ShoppingItem.findById(item._id)).lean());
  } catch (error) { res.status(500).json({ error: 'Could not update task' }); }
});
router.delete('/family/:id', auth, async (req, res) => {
  try { const family = await familyFor(req); if (!family) return res.status(403).json({ error: 'Not a family member' });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid task' });
    const item = await ShoppingItem.findOneAndDelete({ _id: req.params.id, familyKey: family.familyKey });
    if (!item) return res.status(404).json({ error: 'Task not found' }); res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Could not delete task' }); }
});

// In-memory storage for demo (in production, use database)
let shoppingItems = [];
let nextId = 1;

// Get all shopping list items
router.get('/', auth, (req, res) => {
  try {
    const userItems = shoppingItems.filter(item => item.userId === req.user.id);
    res.json(userItems);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Add new shopping list item
router.post('/', auth, (req, res) => {
  try {
    const { name, category = 'other' } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Item name is required' });
    }

    const newItem = {
      _id: nextId++,
      name: name.trim(),
      category,
      completed: false,
      userId: req.user.id,
      createdAt: new Date()
    };

    shoppingItems.push(newItem);
    res.status(201).json(newItem);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Update shopping list item
router.put('/:id', auth, (req, res) => {
  try {
    const { id } = req.params;
    const { completed, name, category } = req.body;
    
    const itemIndex = shoppingItems.findIndex(
      item => item._id == id && item.userId === req.user.id
    );
    
    if (itemIndex === -1) {
      return res.status(404).json({ message: 'Item not found' });
    }

    // Update item
    if (completed !== undefined) shoppingItems[itemIndex].completed = completed;
    if (name !== undefined) shoppingItems[itemIndex].name = name.trim();
    if (category !== undefined) shoppingItems[itemIndex].category = category;
    
    shoppingItems[itemIndex].updatedAt = new Date();
    
    res.json(shoppingItems[itemIndex]);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete shopping list item
router.delete('/:id', auth, (req, res) => {
  try {
    const { id } = req.params;
    
    const itemIndex = shoppingItems.findIndex(
      item => item._id == id && item.userId === req.user.id
    );
    
    if (itemIndex === -1) {
      return res.status(404).json({ message: 'Item not found' });
    }

    shoppingItems.splice(itemIndex, 1);
    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
