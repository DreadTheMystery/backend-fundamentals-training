console.log("Start");

setTimeout(() => {
  console.log("Timeout 1");
}, 0);

setTimeout(() => {
  console.log("Timeout 2");
}, 0);

Promise.resolve().then(() => {
  console.log("Promise 1");
});

Promise.resolve().then(() => {
  console.log("Promise 2");
});

process.nextTick(() => {
  console.log("NextTick 1");
});

process.nextTick(() => {
  console.log("NextTick 2");
});

console.log("End");
