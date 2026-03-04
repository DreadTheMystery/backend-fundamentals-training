#!/usr/bin/env node

/**
 * Combined Cache + Rate Limiter Test
 * 
 * Demonstrates how cache-aside + stampede prevention + rate limiting
 * work together to protect SQLite from burst traffic
 */

const http = require('http');

const HOST = 'localhost';
const PORT = 3000;
const ENDPOINT = '/users';

// Test scenarios
const SCENARIOS = [
  { name: 'Burst Wave 1', requests: 30, description: 'First 30 requests - should all hit cache after initial miss' },
  { name: 'Burst Wave 2', requests: 25, description: 'Next 25 requests - rate limit kicks in at 50' },
  { name: 'Burst Wave 3', requests: 10, description: 'Final 10 requests - all rate limited' }
];

let stats = {
  total: 0,
  success: 0,
  rateLimited: 0,
  cacheHit: 0,
  cacheMiss: 0,
  cacheRebuild: 0,
  cacheWait: 0
};

console.log('🚀 Combined Cache + Rate Limiter Test\n');
console.log('Testing: Cache stampede prevention + Rate limiting');
console.log('Rate limit: 50 requests per 60 seconds');
console.log('Cache: 60s TTL with lock-based stampede prevention\n');
console.log('='.repeat(60));

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
        stats.total++;
        
        const result = {
          request: index,
          status: res.statusCode,
          cache: res.headers['x-cache'],
          rateLimit: {
            limit: res.headers['x-ratelimit-limit'],
            remaining: res.headers['x-ratelimit-remaining'],
            reset: res.headers['x-ratelimit-reset']
          },
          retryAfter: res.headers['retry-after']
        };

        if (res.statusCode === 200) {
          stats.success++;
          
          // Track cache behavior
          if (result.cache === 'HIT') {
            stats.cacheHit++;
          } else if (result.cache === 'MISS-REBUILD') {
            stats.cacheMiss++;
          } else if (result.cache === 'HIT-AFTER-WAIT') {
            stats.cacheWait++;
          } else if (result.cache === 'MISS-FALLBACK') {
            stats.cacheRebuild++;
          }
        } else if (res.statusCode === 429) {
          stats.rateLimited++;
        }

        resolve(result);
      });
    });

    req.on('error', (err) => {
      console.error(`❌ Request ${index} failed:`, err.message);
      resolve(null);
    });

    req.end();
  });
};

const runScenario = async (scenario, startIndex) => {
  console.log(`\n📊 ${scenario.name} (${scenario.requests} requests)`);
  console.log(`   ${scenario.description}`);
  console.log('-'.repeat(60));
  
  const promises = [];
  for (let i = 0; i < scenario.requests; i++) {
    promises.push(makeRequest(startIndex + i));
  }
  
  await Promise.all(promises);
  
  console.log(`   ✅ Success: ${stats.success - (startIndex > 0 ? 
    SCENARIOS.slice(0, SCENARIOS.findIndex(s => s.name === scenario.name))
      .reduce((sum, s) => sum + Math.min(s.requests, 50), 0) : 0)}`);
  console.log(`   ❌ Rate Limited: ${stats.rateLimited - (startIndex > 0 ? 
    SCENARIOS.slice(0, SCENARIOS.findIndex(s => s.name === scenario.name))
      .reduce((sum, s) => sum + Math.max(0, s.requests - 50), 0) : 0)}`);
};

const runTest = async () => {
  const startTime = Date.now();
  
  let requestIndex = 1;
  for (const scenario of SCENARIOS) {
    await runScenario(scenario, requestIndex);
    requestIndex += scenario.requests;
    
    // Small delay between waves to see rate limit behavior
    if (scenario !== SCENARIOS[SCENARIOS.length - 1]) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  // Final results
  console.log('\n' + '='.repeat(60));
  console.log('📈 FINAL RESULTS');
  console.log('='.repeat(60));
  console.log(`Total requests sent:       ${stats.total}`);
  console.log(`✅ Successful (200):       ${stats.success}`);
  console.log(`❌ Rate limited (429):     ${stats.rateLimited}`);
  console.log('');
  console.log('Cache Performance:');
  console.log(`   🎯 Cache HIT:           ${stats.cacheHit} (served from Redis)`);
  console.log(`   🔄 Cache MISS-REBUILD:  ${stats.cacheMiss} (rebuilt from DB)`);
  console.log(`   ⏱️  Cache HIT-AFTER-WAIT: ${stats.cacheWait} (waited for lock)`);
  console.log(`   📦 Cache MISS-FALLBACK: ${stats.cacheRebuild} (fallback to DB)`);
  console.log('');
  console.log(`⏱️  Total duration:        ${duration}s`);
  console.log(`📊 Requests per second:   ${(stats.total / duration).toFixed(2)}`);
  console.log('='.repeat(60));
  
  // Calculate cache efficiency
  const dbQueries = stats.cacheMiss + stats.cacheRebuild + 1; // +1 for initial
  const cacheEfficiency = ((stats.cacheHit + stats.cacheWait) / stats.success * 100).toFixed(1);
  
  console.log('\n🎯 Protection Analysis:');
  console.log(`   DB queries prevented: ${stats.success - dbQueries} out of ${stats.success}`);
  console.log(`   Cache efficiency: ${cacheEfficiency}%`);
  console.log(`   Rate limiter blocked: ${stats.rateLimited} excess requests`);
  
  if (stats.cacheMiss <= 2 && stats.rateLimited >= 15) {
    console.log('\n✅ EXCELLENT: Both cache stampede prevention and rate limiting working!');
    console.log('   - Cache prevented DB stampede (only 1-2 DB queries despite burst)');
    console.log('   - Rate limiter blocked excess traffic at 50 req/min');
  } else {
    console.log('\n⚠️  Check system behavior:');
    console.log(`   Cache misses: ${stats.cacheMiss} (expected: 1-2)`);
    console.log(`   Rate limited: ${stats.rateLimited} (expected: ~15)`);
  }
  
  console.log('\n💡 Check Redis:');
  console.log('   redis-cli KEYS "rate_limit:*"');
  console.log('   redis-cli KEYS "users:all:*"');
};

// Run the test
runTest().catch(console.error);
