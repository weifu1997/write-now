const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createApp } = require("../dist/app.js");
const { resolveSiteAuthConfig } = require("../dist/platform/auth/siteAuthConfig.js");
const { isSiteAuthPublicPath } = require("../dist/platform/auth/siteAuthPaths.js");
const { createSessionToken, verifySessionToken } = require("../dist/platform/auth/siteAuthSession.js");
const { resetLoginAttempts } = require("../dist/platform/auth/siteAuthRateLimit.js");

const ENV_KEYS = [
  "NODE_ENV",
  "AI_NOVEL_RUNTIME",
  "SITE_AUTH_REQUIRED",
  "SITE_AUTH_USERNAME",
  "SITE_AUTH_PASSWORD",
  "SITE_AUTH_SECRET",
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(address.port);
    });
  });
}

function rawGet(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path: requestPath,
      method: "GET",
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({ status: response.statusCode ?? 0, body });
      });
    });
    request.on("error", reject);
    request.end();
  });
}

function cookieHeader(response) {
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];
  const raw = cookies[0] || response.headers.get("set-cookie");
  if (!raw) {
    return "";
  }
  return raw.split(";")[0];
}

async function withServer(run) {
  const app = createApp();
  const server = http.createServer(app);
  const port = await listen(server);
  try {
    await run(port);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("site auth defaults skip desktop production and require other production", () => {
  const snapshot = snapshotEnv();
  try {
    delete process.env.SITE_AUTH_REQUIRED;
    process.env.NODE_ENV = "production";
    process.env.AI_NOVEL_RUNTIME = "desktop";
    assert.equal(resolveSiteAuthConfig().required, false);

    delete process.env.AI_NOVEL_RUNTIME;
    assert.equal(resolveSiteAuthConfig().required, true);

    process.env.NODE_ENV = "development";
    assert.equal(resolveSiteAuthConfig().required, false);

    process.env.SITE_AUTH_REQUIRED = "true";
    assert.equal(resolveSiteAuthConfig().required, true);
  } finally {
    restoreEnv(snapshot);
  }
});

test("site auth public paths keep health, login and channel callbacks open", () => {
  assert.equal(isSiteAuthPublicPath("/api/health"), true);
  assert.equal(isSiteAuthPublicPath("/api/health/"), true);
  assert.equal(isSiteAuthPublicPath("/api/auth/login"), true);
  assert.equal(isSiteAuthPublicPath("/api/auto-director/channel-callbacks/dingtalk"), true);
  assert.equal(isSiteAuthPublicPath("/api/market-radar/sources"), false);
  assert.equal(isSiteAuthPublicPath("/api/drama/projects"), false);
  assert.equal(isSiteAuthPublicPath("/api/health/../market-radar/sources"), false);
  assert.equal(isSiteAuthPublicPath("/api/auth/login/../../novels"), false);
  assert.equal(isSiteAuthPublicPath("/api/auto-director/channel-callbackss"), false);
});

test("site auth session token verifies expiry", () => {
  const token = createSessionToken("secret", 1_000_000, 10);
  assert.equal(verifySessionToken(token, "secret", 1_000_000), true);
  assert.equal(verifySessionToken(token, "other", 1_000_000), false);
  assert.equal(verifySessionToken(token, "secret", 1_000_000 + 11_000), false);
});

test("unconfigured production site auth rejects business APIs but keeps health open", async () => {
  const snapshot = snapshotEnv();
  resetLoginAttempts();
  process.env.NODE_ENV = "production";
  delete process.env.AI_NOVEL_RUNTIME;
  process.env.SITE_AUTH_REQUIRED = "true";
  delete process.env.SITE_AUTH_USERNAME;
  delete process.env.SITE_AUTH_PASSWORD;
  try {
    await withServer(async (port) => {
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      assert.equal(health.status, 200);

      const status = await fetch(`http://127.0.0.1:${port}/api/auth/status`);
      assert.equal(status.status, 200);
      const statusPayload = await status.json();
      assert.equal(statusPayload.data.required, true);
      assert.equal(statusPayload.data.configured, false);

      const radar = await fetch(`http://127.0.0.1:${port}/api/market-radar/sources`);
      assert.equal(radar.status, 503);
      const radarPayload = await radar.json();
      assert.equal(radarPayload.message, "SITE_AUTH_UNCONFIGURED");

      const drama = await fetch(`http://127.0.0.1:${port}/api/drama/projects`);
      assert.equal(drama.status, 503);

      const traversal = await rawGet(port, "/api/health/../market-radar/sources");
      assert.equal(traversal.status, 503);
    });
  } finally {
    restoreEnv(snapshot);
  }
});

test("desktop production remains open without site credentials", async () => {
  const snapshot = snapshotEnv();
  process.env.NODE_ENV = "production";
  process.env.AI_NOVEL_RUNTIME = "desktop";
  delete process.env.SITE_AUTH_REQUIRED;
  delete process.env.SITE_AUTH_USERNAME;
  delete process.env.SITE_AUTH_PASSWORD;
  try {
    await withServer(async (port) => {
      const radar = await fetch(`http://127.0.0.1:${port}/api/market-radar/sources`);
      assert.equal(radar.status, 200);
    });
  } finally {
    restoreEnv(snapshot);
  }
});

test("configured site auth rejects anonymous access and accepts a valid login cookie", async () => {
  const snapshot = snapshotEnv();
  resetLoginAttempts();
  process.env.SITE_AUTH_REQUIRED = "true";
  process.env.SITE_AUTH_USERNAME = "operator";
  process.env.SITE_AUTH_PASSWORD = "correct-horse";
  try {
    await withServer(async (port) => {
      const anonymous = await fetch(`http://127.0.0.1:${port}/api/market-radar/sources`);
      assert.equal(anonymous.status, 401);
      const anonymousPayload = await anonymous.json();
      assert.equal(anonymousPayload.message, "SITE_AUTH_UNAUTHENTICATED");

      const director = await fetch(`http://127.0.0.1:${port}/api/novels/director/tasks/demo`);
      assert.equal(director.status, 401);

      const wrong = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "operator", password: "wrong" }),
      });
      assert.equal(wrong.status, 401);

      const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "operator", password: "correct-horse" }),
      });
      assert.equal(login.status, 200);
      const cookie = cookieHeader(login);
      assert.match(cookie, /^wn_site_session=/);

      const authorized = await fetch(`http://127.0.0.1:${port}/api/market-radar/sources`, {
        headers: { Cookie: cookie },
      });
      assert.equal(authorized.status, 200);

      const callback = await fetch(`http://127.0.0.1:${port}/api/auto-director/channel-callbacks/dingtalk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "u1",
          callbackId: "c1",
          eventId: "e1",
          taskId: "t1",
          actionCode: "continue_auto_execution",
        }),
      });
      assert.notEqual(callback.status, 401);
      assert.notEqual(callback.status, 503);
    });
  } finally {
    restoreEnv(snapshot);
  }
});
