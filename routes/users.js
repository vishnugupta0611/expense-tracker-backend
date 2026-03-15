const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');

// @route   PUT /api/users/profile
// @desc    Update user profile & settings
// @access  Private
router.put('/profile', auth, async (req, res) => {
  try {
    const { defaultView, budgets, name, avatar } = req.body;
    
    const updates = {};
    if (name) updates.name = name;
    if (defaultView) updates.defaultView = defaultView;
    if (avatar !== undefined) updates.avatar = avatar;
    
    // Handle budget updates
    if (budgets) {
      if (budgets.monthly !== undefined) updates['budgets.monthly'] = budgets.monthly;
      if (budgets.daily !== undefined) updates['budgets.daily'] = budgets.daily;
      if (budgets.categoryBudgets) updates['budgets.categoryBudgets'] = budgets.categoryBudgets;
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-password -googleId');

    res.json(user);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// @route   GET /api/users/profile
// @desc    Get user profile with full details
// @access  Private
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -googleId');
    res.json(user);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});


router.get('/is_server_fine',(req,res)=>{
     try {

      return res.status(200).json({
        success:true,
        message:"working fine"
      })
      
     } catch (error) {
          return res.status(500)
          .json({
            success:false,
            message:"internal server error"
          })
     }
})

module.exports = router;
