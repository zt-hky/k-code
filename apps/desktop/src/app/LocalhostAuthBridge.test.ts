// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Tests exercise the real loopback listener.
import * as NodeHttp from "node:http";
import { describe, expect, it } from "vite-plus/test";

import {
  cancelLocalhostAuthCallback,
  receiveLocalhostAuthCallback,
} from "./LocalhostAuthBridge.ts";

const STATE = "0123456789abcdef0123456789abcdef";

async function freePort() {
  const server = NodeHttp.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

const authorizationUrl = (port: number, state = STATE) =>
  `https://auth.openai.com/oauth/authorize?client_id=app&redirect_uri=${encodeURIComponent(
    `http://localhost:${port}/auth/callback`,
  )}&state=${state}`;

/** Starts the bridge and resolves with its outcome promise once the port accepts connections. */
function start(url: string, options?: { timeoutMs?: number; signal?: AbortSignal }) {
  const ready = Promise.withResolvers<void>();
  const outcome = receiveLocalhostAuthCallback(url, {
    ...options,
    onListening: () => ready.resolve(),
  });
  // A bridge that never listens (a busy port) settles its outcome instead.
  void outcome.then(() => ready.resolve());
  return { outcome, ready: ready.promise };
}

// fetch forbids overriding Host, which the rebinding check needs.
const send = (port: number, path: string, host = `localhost:${port}`, method = "GET") =>
  new Promise<{ status: number; text: () => Promise<string> }>((resolve, reject) => {
    const request = NodeHttp.request(
      { host: "127.0.0.1", port, path, method, headers: { host } },
      (response) => {
        const chunks: Array<Buffer> = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            text: async () => Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
const get = (port: number, path: string, host?: string) => send(port, path, host);

describe("localhost auth bridge", () => {
  it("catches the matching callback, answers with a close-this-tab page, and frees the port", async () => {
    const port = await freePort();
    const { outcome, ready } = start(authorizationUrl(port));
    await ready;

    const response = await get(port, `/auth/callback?code=abc&state=${STATE}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("You can close this tab");
    expect(await outcome).toEqual({
      status: "received",
      callbackUrl: `http://localhost:${port}/auth/callback?code=abc&state=${STATE}`,
    });

    // One-shot: the port can be bound again straight away.
    const again = NodeHttp.createServer();
    await new Promise<void>((resolve) => again.listen(port, "127.0.0.1", resolve));
    await new Promise<void>((resolve) => again.close(() => resolve()));
  });

  it("keeps waiting through other paths, a wrong state, and a rebinding Host", async () => {
    const port = await freePort();
    const { outcome, ready } = start(authorizationUrl(port));
    await ready;

    expect((await get(port, `/launch?code=abc&state=${STATE}`)).status).toBe(404);
    expect((await get(port, "/auth/callback?code=abc&state=foreign")).status).toBe(400);
    expect((await get(port, `/auth/callback?code=abc&state=${STATE}`, "evil.example")).status).toBe(
      421,
    );
    expect(
      (await send(port, `/auth/callback?code=abc&state=${STATE}`, undefined, "POST")).status,
    ).toBe(405);

    await get(port, `/auth/callback?error=access_denied&state=${STATE}`);
    expect(await outcome).toMatchObject({ status: "received" });
  });

  it("reports a busy port so the panel falls back to pasting", async () => {
    const port = await freePort();
    const holder = NodeHttp.createServer();
    await new Promise<void>((resolve) => holder.listen(port, "127.0.0.1", resolve));
    try {
      expect(await receiveLocalhostAuthCallback(authorizationUrl(port))).toEqual({
        status: "unavailable",
        reason: "port_busy",
      });
    } finally {
      await new Promise<void>((resolve) => holder.close(() => resolve()));
    }
  });

  it("refuses an authorization URL without a localhost redirect", async () => {
    expect(
      await receiveLocalhostAuthCallback(
        `https://auth.example.com/authorize?redirect_uri=${encodeURIComponent("https://example.com/cb")}&state=${STATE}`,
      ),
    ).toEqual({ status: "unavailable", reason: "invalid_request" });
  });

  it("gives up after its deadline and releases the port", async () => {
    const port = await freePort();
    expect(await receiveLocalhostAuthCallback(authorizationUrl(port), { timeoutMs: 50 })).toEqual({
      status: "unavailable",
      reason: "expired",
    });
    const again = NodeHttp.createServer();
    await new Promise<void>((resolve) => again.listen(port, "127.0.0.1", resolve));
    await new Promise<void>((resolve) => again.close(() => resolve()));
  });

  it("stops when the sign-in is cancelled, by URL or by signal", async () => {
    const port = await freePort();
    const url = authorizationUrl(port);
    const first = start(url);
    await first.ready;
    cancelLocalhostAuthCallback(url);
    expect(await first.outcome).toEqual({ status: "unavailable", reason: "cancelled" });

    const controller = new AbortController();
    const second = start(url, { signal: controller.signal });
    await second.ready;
    controller.abort();
    expect(await second.outcome).toEqual({ status: "unavailable", reason: "cancelled" });
    expect(await receiveLocalhostAuthCallback(url, { signal: controller.signal })).toEqual({
      status: "unavailable",
      reason: "cancelled",
    });
  });

  it("lets a second request for the same sign-in replace the first", async () => {
    const port = await freePort();
    const url = authorizationUrl(port);
    const first = start(url);
    await first.ready;
    const second = start(url);
    expect(await first.outcome).toEqual({ status: "unavailable", reason: "cancelled" });
    await second.ready;
    await get(port, `/auth/callback?code=abc&state=${STATE}`);
    expect(await second.outcome).toMatchObject({ status: "received" });
  });
});
