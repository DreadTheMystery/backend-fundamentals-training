const bcrypt = require('bcryptjs');
const { dbGet } = require('../data/database');
const { generateToken } = require('../middleware/auth');
const ApiError = require('../utils/ApiError');

// POST /login → Authenticate user and return JWT
const login = async (req, res) => {
  const { email, password } = req.body;
  
  // Validation
  if (!email || !password) {
    throw new ApiError(400, 'Email and password are required');
  }
  
  // Find user by email
  const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
  
  if (!user) {
    throw new ApiError(401, 'Invalid email or password');
  }
  
  // Check if user has a password (for now, we'll accept a hardcoded check)
  // In a real app, passwords would be hashed in the database
  if (!user.password) {
    throw new ApiError(401, 'User account not configured for authentication');
  }
  
  // Verify password
  const isValidPassword = await bcrypt.compare(password, user.password);
  
  if (!isValidPassword) {
    throw new ApiError(401, 'Invalid email or password');
  }
  
  // Generate JWT token
  const token = generateToken(user.id, user.email, user.role || 'user');
  
  res.status(200).json({
    success: true,
    message: 'Login successful',
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role || 'user'
    }
  });
};

module.exports = {
  login
};
