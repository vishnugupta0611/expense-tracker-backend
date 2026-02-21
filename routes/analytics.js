const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Expense = require('../models/Expense');
const SpaceExpense = require('../models/SpaceExpense');
const Space = require('../models/Space');

// @route   GET /api/analytics/personal
// @desc    Get personal expense analytics
// @access  Private
router.get('/personal', auth, async (req, res) => {
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

    // Daily breakdown for graph
    const dailyBreakdown = {};
    expenses.forEach(expense => {
      const day = expense.date.getDate();
      if (!dailyBreakdown[day]) {
        dailyBreakdown[day] = 0;
      }
      dailyBreakdown[day] += expense.amount;
    });

    res.json({
      total,
      categoryBreakdown,
      dailyBreakdown,
      expenseCount: expenses.length,
    });
  } catch (error) {
    console.error('Get personal analytics error:', error);
    res.status(500).json({ error: 'Failed to get personal analytics' });
  }
});

// @route   GET /api/analytics/space/:id
// @desc    Get space analytics
// @access  Private
router.get('/space/:id', auth, async (req, res) => {
  try {
    const space = await Space.findOne({ _id: req.params.id, members: req.userId })
      .populate('members', 'name email');

    if (!space) {
      return res.status(404).json({ error: 'Space not found' });
    }

    const expenses = await SpaceExpense.find({ spaceId: req.params.id })
      .populate('paidBy splitBetween', 'name email');

    const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);

    // Category-wise breakdown
    const categoryBreakdown = {};
    expenses.forEach(expense => {
      if (!categoryBreakdown[expense.category]) {
        categoryBreakdown[expense.category] = 0;
      }
      categoryBreakdown[expense.category] += expense.amount;
    });

    // Member contribution breakdown
    const memberContribution = {};
    space.members.forEach(member => {
      memberContribution[member._id.toString()] = {
        name: member.name,
        paid: 0,
        share: 0,
      };
    });

    expenses.forEach(expense => {
      const paidById = expense.paidBy._id.toString();
      if (memberContribution[paidById]) {
        memberContribution[paidById].paid += expense.amount;
      }

      const splitAmount = expense.amount / expense.splitBetween.length;
      expense.splitBetween.forEach(member => {
        const memberId = member._id.toString();
        if (memberContribution[memberId]) {
          memberContribution[memberId].share += splitAmount;
        }
      });
    });

    // Calculate balances
    Object.keys(memberContribution).forEach(memberId => {
      const member = memberContribution[memberId];
      member.balance = member.paid - member.share;
    });

    // Monthly breakdown
    const monthlyBreakdown = {};
    expenses.forEach(expense => {
      const monthKey = `${expense.date.getFullYear()}-${expense.date.getMonth() + 1}`;
      if (!monthlyBreakdown[monthKey]) {
        monthlyBreakdown[monthKey] = 0;
      }
      monthlyBreakdown[monthKey] += expense.amount;
    });

    // Budget status
    const budgetStatus = {};
    const categoryBudgets = space.budgets.categoryBudgets || {};

    Object.keys(categoryBreakdown).forEach(category => {
      const budget = categoryBudgets.get ? categoryBudgets.get(category) || 0 : categoryBudgets[category] || 0;
      budgetStatus[category] = {
        spent: categoryBreakdown[category],
        budget,
        exceeded: budget > 0 && categoryBreakdown[category] > budget,
      };
    });

    res.json({
      total,
      categoryBreakdown,
      memberContribution,
      monthlyBreakdown,
      budgetStatus,
      expenseCount: expenses.length,
    });
  } catch (error) {
    console.error('Get space analytics error:', error);
    res.status(500).json({ error: 'Failed to get space analytics' });
  }
});

module.exports = router;
