const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const {
  getHome,
  getUsers,
  createUser,
  updateUser,
  deleteUser
} = require('../controllers/userController');

// GET / → returns plain text
router.get('/', asyncHandler(getHome));

// GET /users → returns JSON array
router.get('/users', asyncHandler(getUsers));

// POST /users → accepts JSON body and stores in memory
router.post('/users', asyncHandler(createUser));

// PUT /users/:id → updates user
router.put('/users/:id', asyncHandler(updateUser));

// DELETE /users/:id → deletes user
router.delete('/users/:id', asyncHandler(deleteUser));

module.exports = router;
