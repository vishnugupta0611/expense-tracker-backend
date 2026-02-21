const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Expense = require('../models/Expense');
const User = require('../models/User');

// @route   POST /api/expenses
// @desc    Add expense (quick add)
// @access  Private
router.post('/', auth, async (req, res) => {
  try {
    const { amount, category, description, date } = req.body;

    if (!amount) {
      return res.status(400).json({ error: 'Amount is required' });
    }

    const expense = new Expense({
      userId: req.userId,
      amount,
      category: category || 'Other',
      description,
      date: date || new Date(),
    });

    await expense.save();
    res.status(201).json({ expense });
  } catch (error) {
    console.error('Add expense error:', error);
    res.status(500).json({ error: 'Failed to add expense' });
  }
});

// @route   GET /api/expenses
// @desc    Get expenses with date filters
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { startDate, endDate, category } = req.query;
    const query = { userId: req.userId };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    if (category) {
      query.category = category;
    }

    const expenses = await Expense.find(query).sort({ date: -1 });
    res.json({ expenses });
  } catch (error) {
    console.error('Get expenses error:', error);
    res.status(500).json({ error: 'Failed to get expenses' });
  }
});

// @route   GET /api/expenses/today
// @desc    Get today's spending
// @access  Private
router.get('/today', auth, async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const expenses = await Expense.find({
      userId: req.userId,
      date: { $gte: startOfDay, $lte: endOfDay },
    });

    const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);

    res.json({ total, expenses });
  } catch (error) {
    console.error('Get today expenses error:', error);
    res.status(500).json({ error: 'Failed to get today\'s expenses' });
  }
});

// @route   GET /api/expenses/monthly
// @desc    Get monthly spending
// @access  Private
router.get('/monthly', auth, async (req, res) => {
  try {
    const { year, month } = req.query;
    
    const startOfMonth = new Date(year || new Date().getFullYear(), month ? month - 1 : new Date().getMonth(), 1);
    const endOfMonth = new Date(year || new Date().getFullYear(), month ? month : new Date().getMonth() + 1, 0, 23, 59, 59, 999);

    const expenses = await Expense.find({
      userId: req.userId,
      date: { $gte: startOfMonth, $lte: endOfMonth },
    });

    const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);

    // Category-wise breakdown
    const categoryBreakdown = {};
    expenses.forEach(expense => {
      if (!categoryBreakdown[expense.category]) {
        categoryBreakdown[expense.category] = 0;
      }
      categoryBreakdown[expense.category] += expense.amount;
    });

    res.json({ total, expenses, categoryBreakdown });
  } catch (error) {
    console.error('Get monthly expenses error:', error);
    res.status(500).json({ error: 'Failed to get monthly expenses' });
  }
});

// @route   GET /api/expenses/budget-status
// @desc    Get budget progress
// @access  Private
router.get('/budget-status', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    
    // Today's budget status
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const todayExpenses = await Expense.find({
      userId: req.userId,
      date: { $gte: startOfDay, $lte: endOfDay },
    });
    const todayTotal = todayExpenses.reduce((sum, expense) => sum + expense.amount, 0);

    // Monthly budget status
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const endOfMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59, 999);

    const monthlyExpenses = await Expense.find({
      userId: req.userId,
      date: { $gte: startOfMonth, $lte: endOfMonth },
    });
    const monthlyTotal = monthlyExpenses.reduce((sum, expense) => sum + expense.amount, 0);

    // Category-wise budget status
    const categoryStatus = {};
    const categoryBudgets = user.budgets.categoryBudgets || {};

    monthlyExpenses.forEach(expense => {
      if (!categoryStatus[expense.category]) {
        categoryStatus[expense.category] = {
          spent: 0,
          budget: categoryBudgets.get ? categoryBudgets.get(expense.category) || 0 : categoryBudgets[expense.category] || 0,
        };
      }
      categoryStatus[expense.category].spent += expense.amount;
    });

    res.json({
      daily: {
        spent: todayTotal,
        budget: user.budgets.daily,
        exceeded: user.budgets.daily > 0 && todayTotal > user.budgets.daily,
      },
      monthly: {
        spent: monthlyTotal,
        budget: user.budgets.monthly,
        exceeded: user.budgets.monthly > 0 && monthlyTotal > user.budgets.monthly,
      },
      categories: categoryStatus,
    });
  } catch (error) {
    console.error('Get budget status error:', error);
    res.status(500).json({ error: 'Failed to get budget status' });
  }
});

// @route   DELETE /api/expenses/:id
// @desc    Delete expense
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const expense = await Expense.findOne({ _id: req.params.id, userId: req.userId });

    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    await expense.deleteOne();
    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    console.error('Delete expense error:', error);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

module.exports = router;
