const http = require("http");
const https = require("https");

const ALERT_COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS || 60_000);

const alertState = {
  total: 0,
  sent: 0,
  failed: 0,
  suppressed: 0,
  lastSentAtByKey: {},
};

const shouldSend = (key) => {
  const now = Date.now();
  const lastSentAt = alertState.lastSentAtByKey[key] || 0;

  if (now - lastSentAt < ALERT_COOLDOWN_MS) {
    alertState.suppressed += 1;
    return false;
  }

  alertState.lastSentAtByKey[key] = now;
  return true;
};

const postToWebhook = (payload) => {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    try {
      const url = new URL(webhookUrl);
      const body = JSON.stringify(payload);

      const transport = url.protocol === "https:" ? https : http;
      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: 5000,
        },
        (res) => {
          res.resume();
          resolve(res.statusCode >= 200 && res.statusCode < 300);
        },
      );

      req.on("timeout", () => {
        req.destroy(new Error("Webhook timeout"));
      });

      req.on("error", () => resolve(false));
      req.write(body);
      req.end();
    } catch {
      resolve(false);
    }
  });
};

const sendAlert = async ({
  key,
  level = "warn",
  title,
  message,
  details = {},
}) => {
  alertState.total += 1;

  if (!shouldSend(key)) {
    return { sent: false, suppressed: true };
  }

  const payload = {
    app: "basic-express-api",
    level,
    title,
    message,
    details,
    timestamp: new Date().toISOString(),
  };

  const fn = level === "error" ? console.error : console.warn;
  fn(`[ALERT] ${title} - ${message}`, details);

  const delivered = await postToWebhook(payload);
  if (delivered) {
    alertState.sent += 1;
  } else if (process.env.ALERT_WEBHOOK_URL) {
    alertState.failed += 1;
  }

  return { sent: delivered, suppressed: false };
};

const getAlertMetrics = () => ({
  ...alertState,
  lastSentAtByKey: { ...alertState.lastSentAtByKey },
});

const resetAlertMetrics = () => {
  alertState.total = 0;
  alertState.sent = 0;
  alertState.failed = 0;
  alertState.suppressed = 0;
  alertState.lastSentAtByKey = {};
};

module.exports = {
  sendAlert,
  getAlertMetrics,
  resetAlertMetrics,
};
