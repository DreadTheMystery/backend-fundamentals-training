const express = require('express');
const app = express();
const PORT = 3000;

// Import routes and middleware
const userRoutes = require('./routes/userRoutes');
const notFoundHandler = require('./middleware/notFoundMiddleware');
const errorHandler = require('./middleware/errorMiddleware');

// Middleware
app.use(express.json());

// Mount routes
app.use('/', userRoutes);

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
