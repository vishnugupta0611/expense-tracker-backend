const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Space = require('../models/Space');
const SpaceExpense = require('../models/SpaceExpense');
const User = require('../models/User');

// @route   GET /api/spaces
// @desc    Get all user spaces

// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const spaces = await Space.find({ members: req.userId }).populate('members', 'name email avatar');
    res.json({ spaces });
  } catch (error) {
    console.error('Get spaces error:', error);
    res.status(500).json({ error: 'Failed to get spaces' });
  }
});

// @route   POST /api/spaces
// @desc    Create space
// @access  Private
router.post('/', auth, async (req, res) => {
  try {
    const { name, memberEmails, budgets } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Space name is required' });
    }

    // Find users by email
    const members = [req.userId]; // Creator is always a member
    
    if (memberEmails && memberEmails.length > 0) {
      const users = await User.find({ email: { $in: memberEmails } });
      users.forEach(user => {
        if (!members.includes(user._id.toString())) {
          members.push(user._id);
        }
      });
    }

    const space = new Space({
      name,
      members,
      createdBy: req.userId,
      budgets: budgets || { monthly: 0, categoryBudgets: {} },
    });

    await space.save();
    await space.populate('members', 'name email avatar');

    res.status(201).json({ space });
  } catch (error) {
    console.error('Create space error:', error);
    res.status(500).json({ error: 'Failed to create space' });
  }
});

// @route   GET /api/spaces/:id
// @desc    Get space details
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const space = await Space.findOne({ _id: req.params.id, members: req.userId })
      .populate('members', 'name email avatar');

    if (!space) {
      return res.status(404).json({ error: 'Space not found' });
    }

    res.json({ space });
  } catch (error) {
    console.error('Get space error:', error);
    res.status(500).json({ error: 'Failed to get space' });
  }
});

// @route   POST /api/spaces/:id/expenses
// @desc    Add space expense
// @access  Private
router.post('/:id/expenses', auth, async (req, res) => {
  try {
    const { amount, category, description, paidBy, splitBetween, date } = req.body;

    if (!amount) {
      return res.status(400).json({ error: 'Amount is required' });
    }

    const space = await Space.findOne({ _id: req.params.id, members: req.userId });

    if (!space) {
      return res.status(404).json({ error: 'Space not found' });
    }

    // Default: paid by current user, split among all members
    const expense = new SpaceExpense({
      spaceId: req.params.id,
      paidBy: paidBy || req.userId,
      splitBetween: splitBetween && splitBetween.length > 0 ? splitBetween : space.members,
      amount,
      category: category || 'Other',
      description,
      date: date || new Date(),
    });

    await expense.save();
    await expense.populate('paidBy splitBetween', 'name email avatar');

    res.status(201).json({ expense });
  } catch (error) {
    console.error('Add space expense error:', error);
    res.status(500).json({ error: 'Failed to add space expense' });
  }
});

// @route   GET /api/spaces/:id/expenses
// @desc    Get space expenses with filtering
// @access  Private
router.get('/:id/expenses', auth, async (req, res) => {
  try {
    const { startDate, endDate, category } = req.query;
    
    const space = await Space.findOne({ _id: req.params.id, members: req.userId });

    if (!space) {
      return res.status(404).json({ error: 'Space not found' });
    }

    const query = { spaceId: req.params.id };

    // Add date filtering
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    // Add category filtering
    if (category) {
      query.category = category;
    }

    const expenses = await SpaceExpense.find(query)
      .populate('paidBy splitBetween', 'name email avatar')
      .populate('comments.userId', 'name')
      .sort({ date: -1 });

    res.json({ expenses });
  } catch (error) {
    console.error('Get space expenses error:', error);
    res.status(500).json({ error: 'Failed to get space expenses' });
  }
});

// @route   GET /api/spaces/:id/balance
// @desc    Get user balance in space (owed/owing)
// @access  Private
router.get('/:id/balance', auth, async (req, res) => {
  try {
    const space = await Space.findOne({ _id: req.params.id, members: req.userId });

    if (!space) {
      return res.status(404).json({ error: 'Space not found' });
    }

    const expenses = await SpaceExpense.find({ spaceId: req.params.id });

    let balance = 0;

    expenses.forEach(expense => {
      const splitAmount = expense.amount / expense.splitBetween.length;
      
      // If user paid
      if (expense.paidBy.toString() === req.userId.toString()) {
        balance += expense.amount - splitAmount; // They are owed
      }
      
      // If user is in split
      if (expense.splitBetween.some(id => id.toString() === req.userId.toString())) {
        if (expense.paidBy.toString() !== req.userId.toString()) {
          balance -= splitAmount; // They owe
        }
      }
    });

    res.json({
      balance,
      status: balance > 0 ? 'owed' : balance < 0 ? 'owing' : 'settled',
      amount: Math.abs(balance),
    });
  } catch (error) {
    console.error('Get balance error:', error);
    res.status(500).json({ error: 'Failed to get balance' });
  }
});

// @route   PATCH /api/spaces/:id/budget
// @desc    Update space budget
// @access  Private
router.patch('/:id/budget', auth, async (req, res) => {
  try {
    const { budgets } = req.body;

    const space = await Space.findOne({ _id: req.params.id, members: req.userId });

    if (!space) {
      return res.status(404).json({ error: 'Space not found' });
    }

    if (budgets) {
      if (budgets.monthly !== undefined) space.budgets.monthly = budgets.monthly;
      if (budgets.categoryBudgets) space.budgets.categoryBudgets = budgets.categoryBudgets;
    }

    await space.save();
    res.json({ space });
  } catch (error) {
    console.error('Update space budget error:', error);
    res.status(500).json({ error: 'Failed to update space budget' });
  }
});

// @route   PUT /api/spaces/:id/budget
// @desc    Update space budget
// @access  Private
router.put('/:id/budget', auth, async (req, res) => {
  try {
    const { monthly, categoryBudgets } = req.body;
    
    // Validate that user is the creator (or admin logic)
    const space = await Space.findOne({ _id: req.params.id, createdBy: req.userId });
    
    if (!space) {
      return res.status(404).json({ error: 'Space not found or unauthorized' });
    }

    if (monthly !== undefined) space.budgets.monthly = monthly;
    if (categoryBudgets) space.budgets.categoryBudgets = categoryBudgets;

    await space.save();
    res.json(space);
  } catch (error) {
    console.error('Update space budget error:', error);
    res.status(500).json({ error: 'Failed to update space budget' });
  }
});

// @route   PUT /api/spaces/:id/settle
// @desc    Mark all current settlements as settled
// @access  Private
router.put('/:id/settle', auth, async (req, res) => {
  try {
    const space = await Space.findOne({ _id: req.params.id, members: req.userId });
    
    if (!space) {
      return res.status(404).json({ error: 'Space not found' });
    }

    space.settledAt = new Date();
    await space.save();
    await space.populate('members', 'name email avatar');
    
    res.json({ space, message: 'All settlements cleared!' });
  } catch (error) {
    console.error('Settle error:', error);
    res.status(500).json({ error: 'Failed to settle' });
  }
});

// @route   POST /api/spaces/expenses/:expenseId/comments
// @desc    Add a comment to a space expense
// @access  Private
router.post('/expenses/:expenseId/comments', auth, async (req, res) => {
  try {
    const { text } = req.body;
    const expense = await SpaceExpense.findById(req.params.expenseId);
    
    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    expense.comments.push({
      userId: req.userId,
      text,
    });

    await expense.save();
    
    // Return the new comment with populated user
    // Or return the whole updated expense
    const updatedExpense = await SpaceExpense.findById(expense._id)
      .populate('paidBy', 'name email')
      .populate('comments.userId', 'name');

    res.json(updatedExpense);
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// @route   PUT /api/spaces/:id
// @desc    Update space (rename, etc.)
// @access  Private
router.put('/:id', auth, async (req, res) => {
  try {
    const { name } = req.body;
    
    const space = await Space.findOne({ _id: req.params.id, createdBy: req.userId });
    
    if (!space) {
      return res.status(404).json({ error: 'Space not found or unauthorized' });
    }

    if (name) space.name = name;

    await space.save();
    await space.populate('members', 'name email avatar');
    
    res.json(space);
  } catch (error) {
    console.error('Update space error:', error);
    res.status(500).json({ error: 'Failed to update space' });
  }
});

// @route   POST /api/spaces/:id/members
// @desc    Add members to space
// @access  Private
router.post('/:id/members', auth, async (req, res) => {
  try {
    const { emails } = req.body;
    
    if (!emails || emails.length === 0) {
      return res.status(400).json({ error: 'Email addresses required' });
    }

    const space = await Space.findOne({ _id: req.params.id, createdBy: req.userId });
    
    if (!space) {
      return res.status(404).json({ error: 'Space not found or unauthorized' });
    }

    // Find users by email
    const users = await User.find({ email: { $in: emails } });
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'No users found with provided emails' });
    }

    // Add new members (avoid duplicates)
    users.forEach(user => {
      if (!space.members.some(m => m.toString() === user._id.toString())) {
        space.members.push(user._id);
      }
    });

    await space.save();
    await space.populate('members', 'name email avatar');
    
    res.json(space);
  } catch (error) {
    console.error('Add members error:', error);
    res.status(500).json({ error: 'Failed to add members' });
  }
});

module.exports = router;
