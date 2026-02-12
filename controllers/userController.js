const { users, nextId } = require('../data/users');

// GET / → returns plain text
const getHome = (req, res) => {
  res.status(200).send('Welcome to the Express API Server');
};

// GET /users → returns JSON array with custom headers
const getUsers = (req, res) => {
  // Add custom headers
  res.setHeader('X-Total-Users', users.length);
  res.setHeader('X-Powered-By-Custom', 'Express-API-v1.0');
  
  res.status(200).json({
    success: true,
    count: users.length,
    data: users
  });
};

// POST /users → accepts JSON body and stores in memory
const createUser = (req, res) => {
  const { name, email } = req.body;
  
  // Validation
  if (!name || !email) {
    return res.status(400).json({
      success: false,
      error: 'Name and email are required fields'
    });
  }
  
  // Check if email already exists
  const existingUser = users.find(u => u.email === email);
  if (existingUser) {
    return res.status(400).json({
      success: false,
      error: 'User with this email already exists'
    });
  }
  
  // Create new user
  const newUser = {
    id: nextId.increment(),
    name,
    email
  };
  
  users.push(newUser);
  
  res.status(201).json({
    success: true,
    message: 'User created successfully',
    data: newUser
  });
};

// PUT /users/:id → updates user
const updateUser = (req, res) => {
  const id = parseInt(req.params.id);
  const { name, email } = req.body;
  
  // Find user
  const userIndex = users.findIndex(u => u.id === id);
  
  if (userIndex === -1) {
    return res.status(404).json({
      success: false,
      error: `User with id ${id} not found`
    });
  }
  
  // Validation
  if (!name && !email) {
    return res.status(400).json({
      success: false,
      error: 'At least one field (name or email) must be provided'
    });
  }
  
  // Check if email already exists (for other users)
  if (email) {
    const existingUser = users.find(u => u.email === email && u.id !== id);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Email already in use by another user'
      });
    }
  }
  
  // Update user
  if (name) users[userIndex].name = name;
  if (email) users[userIndex].email = email;
  
  res.status(200).json({
    success: true,
    message: 'User updated successfully',
    data: users[userIndex]
  });
};

// DELETE /users/:id → deletes user
const deleteUser = (req, res) => {
  const id = parseInt(req.params.id);
  
  // Find user
  const userIndex = users.findIndex(u => u.id === id);
  
  if (userIndex === -1) {
    return res.status(404).json({
      success: false,
      error: `User with id ${id} not found`
    });
  }
  
  // Delete user
  const deletedUser = users.splice(userIndex, 1)[0];
  
  res.status(200).json({
    success: true,
    message: 'User deleted successfully',
    data: deletedUser
  });
};

module.exports = {
  getHome,
  getUsers,
  createUser,
  updateUser,
  deleteUser
};
