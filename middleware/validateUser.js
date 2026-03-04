const ApiError = require('../utils/ApiError');

// Validate user creation
const validateCreateUser = (req, res, next) => {
  const { name, email } = req.body;
  
  // Check required fields
  if (!name || !email) {
    throw new ApiError(400, 'Name and email are required fields');
  }
  
  // Validate name length
  if (typeof name !== 'string' || name.trim().length < 3) {
    throw new ApiError(400, 'Name must be at least 3 characters long');
  }
  
  if (name.trim().length > 50) {
    throw new ApiError(400, 'Name must not exceed 50 characters');
  }
  
  // Validate email format (RFC 5322 compliant)
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email)) {
    throw new ApiError(400, 'Invalid email format');
  }
  
  next();
};

// Validate user update
const validateUpdateUser = (req, res, next) => {
  const { name, email } = req.body;
  
  if (!name && !email) {
    throw new ApiError(400, 'At least one field (name or email) must be provided');
  }
  
  // If name provided, validate length
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 3) {
      throw new ApiError(400, 'Name must be at least 3 characters long');
    }
    
    if (name.trim().length > 50) {
      throw new ApiError(400, 'Name must not exceed 50 characters');
    }
  }
  
  // If email provided, validate format
  if (email) {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      throw new ApiError(400, 'Invalid email format');
    }
  }
  
  next();
};

module.exports = {
  validateCreateUser,
  validateUpdateUser
};
