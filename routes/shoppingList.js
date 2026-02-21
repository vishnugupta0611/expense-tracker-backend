const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

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