const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Category = require('../models/Category');

// @route   GET /api/categories
// @desc    Get all categories (default + custom)
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const categories = await Category.find({ userId: req.userId }).sort({ isDefault: -1, name: 1 });
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

    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    // Check if category already exists
    const existingCategory = await Category.findOne({ userId: req.userId, name });
    if (existingCategory) {
      return res.status(400).json({ error: 'Category already exists' });
    }

    const category = new Category({
      userId: req.userId,
      name,
      isDefault: false,
    });

    await category.save();
    res.status(201).json({ category });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// @route   PATCH /api/categories/:id
// @desc    Edit category
// @access  Private
router.patch('/:id', auth, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const category = await Category.findOne({ _id: req.params.id, userId: req.userId });

    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Don't allow editing default categories
    if (category.isDefault) {
      return res.status(400).json({ error: 'Cannot edit default categories' });
    }

    category.name = name;
    await category.save();

    res.json({ category });
  } catch (error) {
    console.error('Edit category error:', error);
    res.status(500).json({ error: 'Failed to edit category' });
  }
});

// @route   DELETE /api/categories/:id
// @desc    Delete category
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const category = await Category.findOne({ _id: req.params.id, userId: req.userId });

    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Don't allow deleting default categories
    if (category.isDefault) {
      return res.status(400).json({ error: 'Cannot delete default categories' });
    }

    await category.deleteOne();
    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

module.exports = router;
