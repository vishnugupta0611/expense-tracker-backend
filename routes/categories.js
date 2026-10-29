const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const Category = require('../models/Category');
const Note     = require('../models/Note');

// ── Default categories for Notes / Knowledge ─────────────────────────────────
const DEFAULT_CATEGORIES = [
  'Project Knowledge',
  'Learnings',
  'Ideas',
  'AI Sharing',
  'Implementation',
];

// Ensure the 5 default categories exist for this user (idempotent)
async function seedDefaultCategories(userId) {
  const ops = DEFAULT_CATEGORIES.map(name => ({
    updateOne: {
      filter: { userId, name },
      update: { $setOnInsert: { userId, name, isDefault: true } },
      upsert: true,
    },
  }));
  await Category.bulkWrite(ops);
}

// @route   GET /api/categories
// @desc    Get all categories (default + custom). Seeds defaults on first call.
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    await seedDefaultCategories(req.userId);
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
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const trimmed = name.trim();
    // Check if category already exists (case-insensitive for safety)
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
// @desc    Rename a custom category (isDefault categories cannot be renamed)
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

    if (category.isDefault) {
      return res.status(400).json({ error: 'Cannot rename default categories' });
    }

    // Check duplicate name
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
// @desc    Delete a custom category — associated notes are preserved (categoryId unassigned)
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const category = await Category.findOne({ _id: req.params.id, userId: req.userId });
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    if (category.isDefault) {
      return res.status(400).json({ error: 'Cannot delete default categories' });
    }

    // Category delete hone par associated notes delete nahi hone chahiye:
    // Unassign category from associated notes while keeping all note data intact
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
