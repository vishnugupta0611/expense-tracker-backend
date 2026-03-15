const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const Category = require('../models/Category');
const auth = require('../middleware/auth');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Default categories to create for new users
const DEFAULT_CATEGORIES = ['Grocery', 'Food', 'Transport', 'Bills', 'Other'];

// Helper function to create default categories for a user
const createDefaultCategories = async (userId) => {
  const categories = DEFAULT_CATEGORIES.map(name => ({
    userId,
    name,
    isDefault: true,
  }));
  await Category.insertMany(categories);
};

// @route   POST /api/auth/google
// @desc    Google OAuth login
// @access  Public
router.post('/google', async (req, res) => {
  try {
    const { token } = req.body;

    // Verify Google token
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name } = payload;

    // Find or create user
    let user = await User.findOne({ email });

    if (!user) {
      user = new User({
        name,
        email,
        googleId,
      });
      await user.save();
      
      // Create default categories for new user
      await createDefaultCategories(user._id);
    }

    // Generate JWT
    const jwtToken = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token: jwtToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        defaultView: user.defaultView,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// @route   POST /api/auth/email/send-otp
// @desc    Send OTP to email (DEV MODE: accepts any OTP)
// @access  Public
router.post('/email/send-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // In development mode, we just acknowledge the request
    // In production, you would generate and send an actual OTP via email service
    res.json({
      message: 'OTP sent successfully (DEV MODE: any OTP will work)',
      email,
    });
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// @route   POST /api/auth/email/verify-otp
// @desc    Verify OTP and login (DEV MODE: accepts any OTP)
// @access  Public
router.post('/email/verify-otp', async (req, res) => {
  try {
    const { email, otp, name } = req.body;
    console.log("hello")

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    // DEV MODE: Accept any OTP
    // In production, verify the OTP against stored value

    // Find or create user

    let user = await User.findOne({ email });
     
    if (!user) {
      if (!name) {
        return res.status(400).json({ error: 'Name is required for new users' });
      }
      
      user = new User({
        name,
        email,
      });
      await user.save();
      
      // Create default categories for new user
      await createDefaultCategories(user._id);
    }


    // Generate JWT
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        defaultView: user.defaultView,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// @route   POST /api/auth/register
// @desc    Register with username + password
// @access  Public
router.post('/register', async (req, res) => {
  try {
    const { username, name, password } = req.body;
    if (!username || !name || !password) {
      return res.status(400).json({ error: 'Username, name and password are required' });
    }

    const email = `${username.trim().toLowerCase().replace(/\s+/g, '_')}@spendly.app`;

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    const bcrypt = require('bcryptjs');
    const hashed = await bcrypt.hash(password, 10);

    const user = new User({ name: name.trim(), email, password: hashed });
    await user.save();
    await createDefaultCategories(user._id);

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, defaultView: user.defaultView, avatar: user.avatar } });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// @route   POST /api/auth/login
// @desc    Login with username + password
// @access  Public
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const email = `${username.trim().toLowerCase().replace(/\s+/g, '_')}@spendly.app`;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    // Support both password-based and legacy OTP users
    if (user.password) {
      const bcrypt = require('bcryptjs');
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) return res.status(400).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, defaultView: user.defaultView, avatar: user.avatar } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me', auth, async (req, res) => {
  try {
    res.json({
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        defaultView: req.user.defaultView,
        budgets: req.user.budgets,
        avatar: req.user.avatar,
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

module.exports = router;
