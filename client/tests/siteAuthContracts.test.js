import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("登录门禁挂在工作台之外，并提供登录路由", async () => {
  const [main, router, gate] = await Promise.all([
    read("src/main.tsx"),
    read("src/router/index.tsx"),
    read("src/components/layout/SiteAuthGate.tsx"),
  ]);
  assert.match(main, /SiteAuthGate/);
  assert.match(main, /ServerStartupGate/);
  assert.match(router, /path: "\/login", element: <LoginPage \/>/);
  assert.match(gate, /required && !status.configured/);
  assert.match(gate, /required && !status.authenticated/);
});

test("浏览器请求带上登录 cookie", async () => {
  const [client, sse, live, hub, chat] = await Promise.all([
    read("src/api/client.ts"),
    read("src/hooks/useSSE.ts"),
    read("src/hooks/useLlmLiveFeed.ts"),
    read("src/api/creativeHub.ts"),
    read("src/pages/chat/components/AssistantChatPanel.tsx"),
  ]);
  assert.match(client, /withCredentials: true/);
  assert.match(client, /isSiteAuthGateError/);
  assert.match(sse, /credentials: "include"/);
  assert.match(live, /credentials: "include"/);
  assert.match(hub, /credentials: "include"/);
  assert.match(chat, /credentials: "include"/);
  assert.match(sse, /notifySiteAuthUnauthorizedFromHttpStatus/);
  assert.match(live, /notifySiteAuthUnauthorizedFromHttpStatus/);
  assert.match(hub, /notifySiteAuthUnauthorizedFromHttpStatus/);
  assert.match(chat, /notifySiteAuthUnauthorizedFromHttpStatus/);
});

test("已登录工作台提供退出", async () => {
  const [navbar, mobile] = await Promise.all([
    read("src/components/layout/Navbar.tsx"),
    read("src/components/layout/mobile/MobileSiteShell.tsx"),
  ]);
  assert.match(navbar, /SiteAuthLogoutButton/);
  assert.match(mobile, /SiteAuthLogoutButton/);
});
