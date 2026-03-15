const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      console.log('Auth Middleware: No token provided');
      return res.status(401).json({ error: 'No authentication token, access denied' });
    }


    
    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      console.log('Auth Middleware: Token verification failed:', err.message);
      return res.status(401).json({ error: 'Token is not valid' });
    }

    const user = await User.findById(decoded.userId);

    if (!user) {
      console.log('Auth Middleware: User not found for ID:', decoded.userId);
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    req.userId = user._id;
    next();
  } catch (error) {
    console.error('Auth Middleware: Unexpected error:', error);
    res.status(401).json({ error: 'Authentication processing failed' });
  }
};

module.exports = auth;
