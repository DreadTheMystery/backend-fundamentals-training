const express = require('express');
const app = express();
const PORT = 4000;

// Route 1 — Blocking (BAD)
app.get('/block', (req, res) => {
  console.log('[/block] Request received - Starting 5 second block...');
  
  const start = Date.now();
  const blockDuration = 5000; // 5 seconds
  
  // Blocking loop - keeps CPU busy for 5 seconds
  while (Date.now() - start < blockDuration) {
    // Intentionally doing nothing - just burning CPU cycles
  }
  
  console.log('[/block] Block finished - Sending response');
  res.json({ 
    message: 'Blocked for 5 seconds',
    blocked: true 
  });
});

// Route 2 — Fast (GOOD)
app.get('/fast', (req, res) => {
  console.log('[/fast] Request received - Responding immediately');
  res.json({ 
    message: 'Fast response',
    blocked: false 
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Blocking Demo Server running on http://localhost:${PORT}\n`);
  console.log('Test it:');
  console.log('1. Open http://localhost:4000/block in one browser tab');
  console.log('2. Immediately open http://localhost:4000/fast in another tab');
  console.log('3. Watch what happens - /fast will be BLOCKED until /block finishes!\n');
});
