const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

// @route   POST /api/users/upload-avatar
// @desc    Upload avatar image to Cloudinary and save URL
// @access  Private
router.post('/upload-avatar', auth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });

    const avatarUrl = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'avatars', resource_type: 'image', transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }] },
        (error, result) => {
          if (error) return reject(error);
          resolve(result.secure_url);
        }
      );
      streamifier.createReadStream(req.file.buffer).pipe(stream);
    });

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { avatar: avatarUrl } },
      { new: true }
    ).select('-password -googleId');

    res.json({ avatar: avatarUrl, user });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

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
