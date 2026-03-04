#!/usr/bin/env node

/**
 * Rate Limiter Test Script
 * 
 * Tests the API rate limiter by sending rapid requests
 * Expects: 100 requests per 15 minutes limit
 */

const http = require('http');

const HOST = 'localhost';
const PORT = 3000;
const ENDPOINT = '/users';
const TOTAL_REQUESTS = 120; // Exceed the limit

let successCount = 0;
let rateLimitedCount = 0;
let errorCount = 0;

console.log('🚀 Starting Rate Limiter Test\n');
console.log(`Target: http://${HOST}:${PORT}${ENDPOINT}`);
console.log(`Total requests: ${TOTAL_REQUESTS}`);
console.log(`Expected limit: 100 requests per 15 minutes\n`);
console.log('Sending requests...\n');

const makeRequest = (index) => {
  return new Promise((resolve) => {
    const options = {
      hostname: HOST,
      port: PORT,
      path: ENDPOINT,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        const result = {
          request: index + 1,
          status: res.statusCode,
          rateLimit: {
            limit: res.headers['x-ratelimit-limit'],
            remaining: res.headers['x-ratelimit-remaining'],
            reset: res.headers['x-ratelimit-reset']
          },
          retryAfter: res.headers['retry-after']
        };

        if (res.statusCode === 200) {
          successCount++;
          // Show progress every 10 requests
          if ((index + 1) % 10 === 0) {
            console.log(`✅ Request ${result.request}: OK (Remaining: ${result.rateLimit.remaining})`);
          }
        } else if (res.statusCode === 429) {
          rateLimitedCount++;
          if (rateLimitedCount === 1) {
            console.log(`\n⛔ Rate limit triggered at request ${result.request}`);
            console.log(`   Retry after: ${result.retryAfter} seconds`);
            console.log(`   Remaining: ${result.rateLimit.remaining}\n`);
          }
          // Show first 5 rate limited responses
          if (rateLimitedCount <= 5) {
            console.log(`❌ Request ${result.request}: 429 Too Many Requests`);
          }
        } else {
          errorCount++;
          console.log(`⚠️  Request ${result.request}: ${res.statusCode}`);
        }

        resolve(result);
      });
    });

    req.on('error', (err) => {
      errorCount++;
      console.error(`❌ Request ${index + 1} failed:`, err.message);
      resolve(null);
    });

    req.end();
  });
};

// Send all requests rapidly (simulate burst traffic)
const runTest = async () => {
  const startTime = Date.now();
  
  // Send requests in parallel batches of 20 for speed
  const batchSize = 20;
  for (let i = 0; i < TOTAL_REQUESTS; i += batchSize) {
    const batch = [];
    for (let j = 0; j < batchSize && (i + j) < TOTAL_REQUESTS; j++) {
      batch.push(makeRequest(i + j));
    }
    await Promise.all(batch);
  }
  
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  // Print results
  console.log('\n' + '='.repeat(50));
  console.log('📊 TEST RESULTS');
  console.log('='.repeat(50));
  console.log(`✅ Successful requests:    ${successCount}`);
  console.log(`❌ Rate limited (429):     ${rateLimitedCount}`);
  console.log(`⚠️  Other errors:          ${errorCount}`);
  console.log(`⏱️  Total duration:        ${duration}s`);
  console.log(`📈 Requests per second:   ${(TOTAL_REQUESTS / duration).toFixed(2)}`);
  console.log('='.repeat(50));
  
  if (successCount === 100 && rateLimitedCount === 20) {
    console.log('\n✅ PASS: Rate limiter working correctly!');
  } else {
    console.log('\n⚠️  Rate limiter behavior:');
    console.log(`   Expected: 100 success, 20 rate limited`);
    console.log(`   Got: ${successCount} success, ${rateLimitedCount} rate limited`);
  }
  
  console.log('\n💡 Tip: Check Redis with `redis-cli KEYS rate_limit:*`');
};

// Run the test
runTest().catch(console.error);
