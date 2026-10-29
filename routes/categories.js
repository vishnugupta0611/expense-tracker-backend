const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const Category = require('../models/Category');
const Note     = require('../models/Note');

// @route   GET /api/categories
// @desc    Get all user-created categories
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const categories = await Category.find({ userId: req.userId }).sort({ name: 1 });
    res.json({ categories });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Failed to get categories' });
  }
});

// @route   POST /api/categories
// @desc    Create custom category
// @access  Private
router.post('/', auth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const trimmed = name.trim();
    // Check if category already exists for this user (case-insensitive)
    const existingCategory = await Category.findOne({
      userId: req.userId,
      name: { $regex: new RegExp(`^${trimmed}$`, 'i') },
    });

    if (existingCategory) {
      return res.status(400).json({ error: 'Category already exists' });
    }

    const category = await Category.create({
      userId: req.userId,
      name: trimmed,
      isDefault: false,
    });

    res.status(201).json({ category });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// @route   PATCH /api/categories/:id
// @desc    Rename category
// @access  Private
router.patch('/:id', auth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const trimmed = name.trim();
    const category = await Category.findOne({ _id: req.params.id, userId: req.userId });
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const duplicate = await Category.findOne({
      userId: req.userId,
      _id: { $ne: category._id },
      name: { $regex: new RegExp(`^${trimmed}$`, 'i') },
    });
    if (duplicate) {
      return res.status(400).json({ error: 'Another category with this name already exists' });
    }

    category.name = trimmed;
    await category.save();

    res.json({ category });
  } catch (error) {
    console.error('Edit category error:', error);
    res.status(500).json({ error: 'Failed to edit category' });
  }
});

// @route   DELETE /api/categories/:id
// @desc    Delete category — associated notes remain preserved (categoryId unassigned)
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const category = await Category.findOne({ _id: req.params.id, userId: req.userId });
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Associated notes are never deleted:
    await Note.updateMany(
      { categoryId: category._id, userId: req.userId },
      { $set: { categoryId: null } }
    );

    await category.deleteOne();
    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

module.exports = router;
