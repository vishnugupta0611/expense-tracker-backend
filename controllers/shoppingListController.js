const ShoppingItem = require('../models/ShoppingItem');

// Get all shopping items for the user
const getShoppingItems = async (req, res) => {
  try {
    const items = await ShoppingItem.find({ userId: req.user.id })
      .sort({ completed: 1, createdAt: -1 }); // Show incomplete items first, then by newest
    
    res.json(items);
  } catch (error) {
    console.error('Error fetching shopping items:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Add a new shopping item
const addShoppingItem = async (req, res) => {
  try {
    const { name, category, priority, notes, estimatedPrice, quantity, unit } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Item name is required' });
    }

    const newItem = new ShoppingItem({
      name: name.trim(),
      category: category || 'groceries',
      priority: priority || 'medium',
      notes: notes?.trim(),
      estimatedPrice,
      quantity: quantity || 1,
      unit: unit || 'piece',
      userId: req.user.id,
    });

    const savedItem = await newItem.save();
    res.status(201).json(savedItem);
  } catch (error) {
    console.error('Error adding shopping item:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Update a shopping item
const updateShoppingItem = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Remove userId from updates to prevent tampering
    delete updates.userId;

    const item = await ShoppingItem.findOneAndUpdate(
      { _id: id, userId: req.user.id },
      updates,
      { new: true, runValidators: true }
    );

    if (!item) {
      return res.status(404).json({ message: 'Shopping item not found' });
    }

    res.json(item);
  } catch (error) {
    console.error('Error updating shopping item:', error);