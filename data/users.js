// In-memory storage for users
let users = [
  { id: 1, name: 'John Doe', email: 'john@example.com' },
  { id: 2, name: 'Jane Smith', email: 'jane@example.com' }
];

let nextId = 3;

module.exports = {
  users,
  nextId: {
    get: () => nextId,
    increment: () => nextId++
  }
};
