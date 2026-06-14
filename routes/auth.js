const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { createClerkClient, verifyToken } = require('@clerk/backend');
const User = require('../models/User');
const Category = require('../models/Category');
const auth = require('../middleware/auth');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Clerk client — used to fetch user details after token verification
const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

// Default categories to create for new users
const DEFAULT_CATEGORIES = ['Grocery', 'Food', 'Transport', 'Bills', 'Other'];

const createDefaultCategories = async (userId) => {
  const categories = DEFAULT_CATEGORIES.map(name => ({ userId, name, isDefault: true }));
  await Category.insertMany(categories);
};

// ── Helper: build our user payload ───────────────────────────────────────────
const userPayload = (user) => ({
  id:          user._id,
  name:        user.name,
  email:       user.email,
  defaultView: user.defaultView,
  avatar:      user.avatar,
  familyKey:   user.familyKey,
});

// ── POST /api/auth/clerk ──────────────────────────────────────────────────────
// Clerk verifies identity (email OTP / Google / phone).
// Frontend sends Clerk's session token here.
// We verify it, find/create user in OUR MongoDB, return OUR JWT.
// After this point Clerk is not involved — all requests use our token.
router.post('/clerk', async (req, res) => {
  try {
    const { sessionToken } = req.body;
    if (!sessionToken) return res.status(400).json({ error: 'sessionToken required' });

    // Verify Clerk session token using standalone verifyToken
    let clerkUserId;
    try {
      console.log('CLERK_SECRET_KEY prefix:', process.env.CLERK_SECRET_KEY?.substring(0, 10));
      const payload = await verifyToken(sessionToken, {
  secretKey: process.env.CLERK_SECRET_KEY,
  jwtKey: process.env.CLERK_JWT_KEY, // supports offline local verification
  authorizedParties: [
    'http://localhost:3000', // for local dev (React standard)
    'http://localhost:5173', // for local dev (Vite)
    'https://manage-sbkuchh.online',
    'https://www.manage-sbkuchh.online', // for prod (exact origin)
    'https://www.manage-sbkuchh.online/' // for prod (fallback)
  ],
  clockSkewInMs: 45000
});
      clerkUserId = payload.sub;

    } catch (err) {
      console.error('Clerk verifyToken failed:', err.message);
      return res.status(401).json({ error: 'Invalid Clerk session token', detail: err.message });
    }

    // Fetch full Clerk user to get email + name
    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    const email = clerkUser.emailAddresses?.[0]?.emailAddress;
    const name  = clerkUser.firstName
      ? `${clerkUser.firstName} ${clerkUser.lastName || ''}`.trim()
      : (email?.split('@')[0] || 'User');
    const avatar = clerkUser.imageUrl || '';

    if (!email) return res.status(400).json({ error: 'No email on Clerk account' });

    // Find or create user in our DB — clerkId or email match
    let user = await User.findOne({ $or: [{ clerkId: clerkUserId }, { email }] });

    if (!user) {
      user = new User({ clerkId: clerkUserId, name, email, avatar });
      await user.save();
      await createDefaultCategories(user._id);
    } else {
      // Backfill clerkId if missing (existing user signing in via Clerk for first time)
      if (!user.clerkId) {
        user.clerkId = clerkUserId;
        if (!user.avatar && avatar) user.avatar = avatar;
        await user.save();
      }
    }

    // Issue our own JWT — Clerk is done here
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: userPayload(user) });
  } catch (error) {
    console.error('Clerk auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// @route   POST /api/auth/google
// @desc    Google OAuth login (legacy — kept for backward compat)
// @access  Public
router.post('/google', async (req, res) => {
  try {
    const { token } = req.body;
    const ticket = await client.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name } = payload;

    let user = await User.findOne({ email });
    if (!user) {
      user = new User({ name, email, googleId });
      await user.save();
      await createDefaultCategories(user._id);
    }

    const jwtToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token: jwtToken, user: userPayload(user) });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// @route   POST /api/auth/email/send-otp
router.post('/email/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    res.json({ message: 'OTP sent successfully (DEV MODE: any OTP will work)', email });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// @route   POST /api/auth/email/verify-otp
router.post('/email/verify-otp', async (req, res) => {
  try {
    const { email, otp, name } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

    let user = await User.findOne({ email });
    if (!user) {
      if (!name) return res.status(400).json({ error: 'Name is required for new users' });
      user = new User({ name, email });
      await user.save();
      await createDefaultCategories(user._id);
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: userPayload(user) });
  } catch (error) {
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// @route   POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, name, password } = req.body;
    if (!username || !name || !password) return res.status(400).json({ error: 'Username, name and password are required' });

    const email = `${username.trim().toLowerCase().replace(/\s+/g, '_')}@spendly.app`;
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: 'Username already taken' });

    const bcrypt = require('bcryptjs');
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ name: name.trim(), email, password: hashed });
    await user.save();
    await createDefaultCategories(user._id);

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: userPayload(user) });
  } catch (error) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// @route   POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

    const email = `${username.trim().toLowerCase().replace(/\s+/g, '_')}@spendly.app`;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid username or password' });

    if (user.password) {
      const bcrypt = require('bcryptjs');
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) return res.status(400).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: userPayload(user) });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// @route   GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  try {
    res.json({
      user: {
        ...userPayload(req.user),
        budgets: req.user.budgets,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user' });
  }
});

module.exports = router;
