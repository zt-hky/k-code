import { describe, expect, it } from "@effect/vitest";

import {
  cloudflareAccessOrigin,
  cloudflareAccessPreflightApproval,
  cloudflareAccessTokenExpiresAtMs,
  isCloudflareAccessChallenge,
} from "./cloudflareAccessPolicy.ts";

describe("isCloudflareAccessChallenge", () => {
  it.each([
    {
      name: "a redirect to the team login",
      response: {
        status: 302,
        location: "https://team.cloudflareaccess.com/cdn-cgi/access/login/kcode.example.test",
        wwwAuthenticate: null,
      },
      expected: true,
    },
    {
      name: "the challenge Access returns to non-browser requests",
      response: {
        status: 401,
        location: null,
        wwwAuthenticate: 'Cloudflare-Access resource_metadata="https://kcode.example.test/"',
      },
      expected: true,
    },
    {
      name: "a redirect to a look-alike host",
      response: {
        status: 302,
        location: "https://cloudflareaccess.com.evil.test/login",
        wwwAuthenticate: null,
      },
      expected: false,
    },
    {
      name: "the environment's own redirect",
      response: { status: 308, location: "https://kcode.example.test/", wwwAuthenticate: null },
      expected: false,
    },
    {
      name: "a server answering normally",
      response: { status: 200, location: null, wwwAuthenticate: null },
      expected: false,
    },
  ])("$name", ({ response, expected }) => {
    expect(isCloudflareAccessChallenge(response)).toBe(expected);
  });
});

describe("cloudflareAccessTokenExpiresAtMs", () => {
  it("reads exp from an unpadded base64url JWT payload", () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1_800_000_000, email: "a?b@c.d" }))
      .toString("base64url")
      .replace(/=+$/u, "");
    expect(cloudflareAccessTokenExpiresAtMs(`header.${payload}.signature`)).toBe(1_800_000_000_000);
    expect(cloudflareAccessTokenExpiresAtMs("not-a-jwt")).toBeNull();
  });
});

describe("cloudflareAccessOrigin", () => {
  it("maps WebSocket upgrades onto the origin Access protects", () => {
    expect(cloudflareAccessOrigin("wss://kcode.example.test/ws?wsTicket=x")).toBe(
      "https://kcode.example.test",
    );
    expect(cloudflareAccessOrigin("ws://127.0.0.1:8080/ws")).toBe("http://127.0.0.1:8080");
    expect(cloudflareAccessOrigin("t3code://app/index.html")).toBeNull();
  });
});

describe("cloudflareAccessPreflightApproval", () => {
  it("approves exactly what the blocked preflight asked for", () => {
    expect(
      cloudflareAccessPreflightApproval({
        Origin: "t3code://app",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,traceparent",
      }),
    ).toEqual({
      "Access-Control-Allow-Origin": ["t3code://app"],
      "Access-Control-Allow-Methods": ["POST"],
      "Access-Control-Allow-Headers": ["authorization,traceparent"],
      Vary: ["Origin"],
    });
  });
});
