const jwt = require('jsonwebtoken');
const ApiError = require('../utils/ApiError');

// Secret key for JWT (in production, use environment variable)
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';

// Generate JWT token
const generateToken = (userId, email, role) => {
  return jwt.sign(
    { id: userId, email, role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
};

// Verify JWT token middleware
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ApiError(401, 'Access denied. No token provided.');
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // Attach user info to request
    next();
  } catch (error) {
    throw new ApiError(401, 'Invalid or expired token');
  }
};

// Check if user has admin role
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    throw new ApiError(401, 'Authentication required');
  }
  
  if (req.user.role !== 'admin') {
    throw new ApiError(403, 'Access denied. Admin privileges required.');
  }
  
  next();
};

module.exports = {
  generateToken,
  verifyToken,
  requireAdmin,
  JWT_SECRET
};
