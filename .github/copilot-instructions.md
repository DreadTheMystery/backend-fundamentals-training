# Copilot Instructions for Express API with JWT Auth & Redis Caching

## Architecture Overview

This is an Express REST API with JWT authentication, SQLite persistence, and Redis caching. The application follows a clean layered architecture:

- **Routes** ([routes/userRoutes.js](routes/userRoutes.js)) → **Controllers** ([controllers/](controllers/)) → **Data Layer** ([data/database.js](data/database.js))
- All async errors flow through `asyncHandler` wrapper to centralized error middleware
- Authentication uses JWT Bearer tokens with role-based access control
- Redis implements cache-aside pattern with stampede prevention

## Critical Error Handling Pattern

**Every async route handler MUST be wrapped in `asyncHandler`:**
```javascript
router.get('/users', asyncHandler(getUsers));  // ✅ Correct
router.get('/users', getUsers);  // ❌ Wrong - unhandled promise rejections
```

Use `throw new ApiError(statusCode, message)` for all errors - it flows to [middleware/errorMiddleware.js](middleware/errorMiddleware.js).

## JWT Authentication Flow

1. User logs in at `POST /login` with email/password ([controllers/authController.js](controllers/authController.js))
2. Server validates credentials via bcryptjs and returns JWT token (24h expiry)
3. Protected routes require `verifyToken` middleware: `Authorization: Bearer <token>`
4. Admin-only routes use `requireAdmin` middleware (checks `role` field)

**Test credentials:** `admin@example.com` / `password123`

**Route protection pattern:**
```javascript
// Public route
router.get('/users', asyncHandler(getUsers));

// Authenticated route
router.post('/users', asyncHandler(verifyToken), asyncHandler(validateCreateUser), asyncHandler(createUser));

// Admin-only route
router.delete('/users/:id', asyncHandler(verifyToken), asyncHandler(requireAdmin), asyncHandler(deleteUser));
```

## Redis Caching with Stampede Prevention

The `getUsers` endpoint implements sophisticated cache-aside with lock-based stampede prevention:

1. **Cache hit** → Return cached data immediately
2. **Cache miss** → Attempt to acquire distributed lock (`SET NX` on `lock:users:all`)
3. **Lock acquired** → Rebuild cache from DB, release lock
4. **Lock NOT acquired** → Wait 50ms, retry cache, fallback to DB if still missing

**Always invalidate cache after mutations:**
```javascript
await redisClient.del('users:all');  // After POST/PUT/DELETE
```

Cache keys follow pattern: `users:all`, locks: `lock:users:all`

## Database Patterns

- Use promisified wrappers: `dbRun()`, `dbAll()`, `dbGet()` from [data/database.js](data/database.js)
- Always use parameterized queries: `dbGet('SELECT * FROM users WHERE email = ?', [email])`
- Check for existing records before INSERT/UPDATE to return proper `ApiError(400, ...)`

## Development Workflow

**Start server:**
```bash
node server.js  # Starts on port 3000
```

**Testing authentication:**
```bash
# 1. Login to get token
curl -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password123"}'

# 2. Use token in protected routes
curl -X POST http://localhost:3000/users \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com"}'
```

**Create test users:**
```bash
node create-test-user.js  # Creates test users with hashed passwords
```

## Project Conventions

- **No TypeScript** - Pure JavaScript with CommonJS modules
- **Response format:** All JSON responses use `{ success: true/false, data/error, ... }` structure
- **Custom headers:** `X-Cache` (HIT/MISS/HIT-AFTER-WAIT), `X-Total-Users`, `X-Powered-By-Custom`
- **Middleware chaining:** Routes use multiple middleware in sequence via `asyncHandler` wrapping each
- **Password handling:** Always use bcryptjs with 10 salt rounds (see [controllers/authController.js](controllers/authController.js))

## External Dependencies

- **Redis** - Must be running on `localhost:6379` (graceful degradation if unavailable)
- **SQLite** - Database file at [data/users.db](data/users.db) (auto-created)
- **JWT Secret** - Defaults to hardcoded string, override with `JWT_SECRET` env var in production

## Key Files Reference

- [server.js](server.js) - Express app setup, middleware mounting order matters
- [middleware/auth.js](middleware/auth.js) - JWT generation/verification, role checks
- [controllers/userController.js](controllers/userController.js) - All CRUD operations with Redis caching logic
- [utils/asyncHandler.js](utils/asyncHandler.js) - Promise error catcher wrapper
- [AUTHENTICATION_GUIDE.md](AUTHENTICATION_GUIDE.md) - Complete testing examples and security features
