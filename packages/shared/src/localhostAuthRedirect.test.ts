import { describe, expect, it } from "vite-plus/test";

import {
  isLocalhostAuthHost,
  matchLocalhostAuthCallback,
  parseLocalhostAuthRedirect,
} from "./localhostAuthRedirect.ts";

const STATE = "bcb1e118b2cf058b8f94426cd7f63d6f";
const authorize = (redirectUri: string, extra = `&state=${STATE}`) =>
  `https://auth.openai.com/oauth/authorize?client_id=app&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}${extra}`;

describe("parseLocalhostAuthRedirect", () => {
  it("reads the port, path and state from the redirect omp recorded for ChatGPT", () => {
    expect(parseLocalhostAuthRedirect(authorize("http://localhost:1455/auth/callback"))).toEqual({
      redirectUri: "http://localhost:1455/auth/callback",
      hostname: "localhost",
      port: 1455,
      path: "/auth/callback",
      state: STATE,
    });
  });

  it("accepts the 127.0.0.1 redirect Google uses", () => {
    const redirect = parseLocalhostAuthRedirect(authorize("http://127.0.0.1:51121/oauth-callback"));
    expect(redirect).toMatchObject({
      hostname: "127.0.0.1",
      port: 51_121,
      path: "/oauth-callback",
    });
  });

  it("takes OpenRouter's callback_url and, with no state, relies on its PKCE challenge", () => {
    const url = `https://openrouter.ai/auth?callback_url=${encodeURIComponent("http://localhost:54549/callback")}&code_challenge=abc&code_challenge_method=S256`;
    expect(parseLocalhostAuthRedirect(url)).toMatchObject({
      port: 54_549,
      path: "/callback",
      state: null,
    });
    expect(
      parseLocalhostAuthRedirect(
        `https://openrouter.ai/auth?callback_url=${encodeURIComponent("http://localhost:54549/callback")}`,
      ),
    ).toBeNull();
  });

  it.each([
    ["a remote redirect", authorize("https://example.com:1455/callback")],
    ["a custom scheme", authorize("zcode://zai-auth/callback")],
    ["https on loopback", authorize("https://localhost:1455/callback")],
    ["a privileged port", authorize("http://localhost:80/callback")],
    ["no port", authorize("http://localhost/callback")],
    ["credentials in the redirect", authorize("http://user:pw@localhost:1455/callback")],
    ["a query in the redirect", authorize("http://localhost:1455/callback?x=1")],
    ["no state", authorize("http://localhost:1455/callback", "")],
    ["a short state", authorize("http://localhost:1455/callback", "&state=abc")],
    ["two states", authorize("http://localhost:1455/callback", `&state=${STATE}&state=${STATE}`)],
    ["no redirect_uri", `https://auth.example.com/authorize?state=${STATE}`],
    ["not a URL", "not a url"],
  ])("rejects %s", (_name, url) => {
    expect(parseLocalhostAuthRedirect(url)).toBeNull();
  });
});

describe("matchLocalhostAuthCallback", () => {
  const redirect = parseLocalhostAuthRedirect(authorize("http://localhost:1455/auth/callback"))!;

  it("returns the full callback URL for the expected path and state", () => {
    expect(matchLocalhostAuthCallback(`/auth/callback?code=abc&state=${STATE}`, redirect)).toBe(
      `http://localhost:1455/auth/callback?code=abc&state=${STATE}`,
    );
  });

  it("forwards a provider error so the sign-in can fail instead of hanging", () => {
    expect(
      matchLocalhostAuthCallback(`/auth/callback?error=access_denied&state=${STATE}`, redirect),
    ).toBe(`http://localhost:1455/auth/callback?error=access_denied&state=${STATE}`);
  });

  it.each([
    ["another path", `/launch?code=abc&state=${STATE}`],
    ["a foreign state", "/auth/callback?code=abc&state=someoneelse"],
    ["no state", "/auth/callback?code=abc"],
    ["a repeated state", `/auth/callback?code=abc&state=${STATE}&state=${STATE}`],
    ["neither code nor error", `/auth/callback?state=${STATE}`],
    ["both code and error", `/auth/callback?code=a&error=b&state=${STATE}`],
    ["an empty code", `/auth/callback?code=&state=${STATE}`],
    ["another origin", `http://evil.example/auth/callback?code=abc&state=${STATE}`],
  ])("ignores %s", (_name, target) => {
    expect(matchLocalhostAuthCallback(target, redirect)).toBeNull();
  });
});

describe("matchLocalhostAuthCallback without a state", () => {
  const redirect = parseLocalhostAuthRedirect(
    `https://openrouter.ai/auth?callback_url=${encodeURIComponent("http://localhost:54549/callback")}&code_challenge=abc`,
  )!;

  it("accepts the code on the right path only", () => {
    expect(matchLocalhostAuthCallback("/callback?code=abc", redirect)).toBe(
      "http://localhost:54549/callback?code=abc",
    );
    expect(matchLocalhostAuthCallback("/other?code=abc", redirect)).toBeNull();
    expect(matchLocalhostAuthCallback("/callback", redirect)).toBeNull();
  });
});

describe("isLocalhostAuthHost", () => {
  it("accepts the redirect's own loopback names and port only", () => {
    expect(isLocalhostAuthHost("localhost:1455", 1455)).toBe(true);
    expect(isLocalhostAuthHost("127.0.0.1:1455", 1455)).toBe(true);
    expect(isLocalhostAuthHost("[::1]:1455", 1455)).toBe(true);
    expect(isLocalhostAuthHost("evil.example:1455", 1455)).toBe(false);
    expect(isLocalhostAuthHost("localhost:1456", 1455)).toBe(false);
    expect(isLocalhostAuthHost(undefined, 1455)).toBe(false);
  });
});
