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

router.post('/update-fcm-token', auth, async (req, res) => {
  try {
    const { fcmtoken } = req.body;  
    if (!fcmtoken) {
      return res.status(400).json({ error: 'FCM token is required' });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { fcmtoken },
      { new: true }
    )
    res.json({ message: 'FCM token updated successfully', user });
  } catch (error) {
    console.error('Update FCM token error:', error);
    res.status(500).json({ error: 'Failed to update FCM token' });
  }
});

// @route   GET /api/users/search
// @desc    Search for usernames by query
// @access  Public
router.get('/search', async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query || query.trim().length < 1) {
      return res.json({ usernames: [] });
    }

    const users = await User.find({
      name: { $regex: query, $options: 'i' }
    })
    .select('name email')
    .limit(10);

    const usernames = users.map(user => ({
      name: user.name,
      email: user.email
    }));

    res.json({ usernames });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

module.exports = router;
