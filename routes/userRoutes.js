const express = require('express');
const router = express.Router();
const {
  getHome,
  getUsers,
  createUser,
  updateUser,
  deleteUser
} = require('../controllers/userController');

// GET / → returns plain text
router.get('/', getHome);

// GET /users → returns JSON array
router.get('/users', getUsers);

// POST /users → accepts JSON body and stores in memory
router.post('/users', createUser);

// PUT /users/:id → updates user
router.put('/users/:id', updateUser);

// DELETE /users/:id → deletes user
router.delete('/users/:id', deleteUser);

module.exports = router;
