import { describe, expect, it } from "@effect/vitest";

import {
  makeOmpLoginScanner,
  parseOmpLoginFailure,
  parseOmpLoginProviders,
  parseOmpLogoutCredentialIds,
} from "./loginOutput.ts";

// Captured from omp 18.13.2 with stdin as a pipe.
const GITLAB_URL_BLOCK =
  '\nOpen this URL in your browser:\nhttps://gitlab.com/oauth/authorize?client_id=abc&response_type=code&state=s\nLocal shortcut (this machine only): http://localhost:8080/launch\nComplete GitLab login in browser. If GitLab responds with "The redirect URI included is not valid", register your own app.\n\n';
const CODE_PROMPT =
  "Waiting for browser authentication...\nPaste the authorization code (or full redirect URL): ";
const DEEPSEEK_OUTPUT =
  "\nOpen this URL in your browser:\nhttps://platform.deepseek.com/api_keys\nCreate or copy your API key from the DeepSeek dashboard\n\nPaste your DeepSeek API key (sk-...): ";

describe("omp login output scanner", () => {
  it("surfaces the browser URL without the loopback shortcut and keeps the instructions", () => {
    const scanner = makeOmpLoginScanner();
    expect(scanner.push(GITLAB_URL_BLOCK)).toEqual([
      {
        _tag: "authorization",
        url: "https://gitlab.com/oauth/authorize?client_id=abc&response_type=code&state=s",
        instructions:
          'Complete GitLab login in browser. If GitLab responds with "The redirect URI included is not valid", register your own app.',
        userCode: null,
      },
    ]);
  });

  it("reads a device code from the instructions that follow the URL", () => {
    const scanner = makeOmpLoginScanner();
    expect(
      scanner.push(
        "\nOpen this URL in your browser:\nhttps://github.com/login/device\nEnter code: 4FBA-425F\n\n",
      ),
    ).toEqual([
      {
        _tag: "authorization",
        url: "https://github.com/login/device",
        instructions: null,
        userCode: "4FBA-425F",
      },
    ]);
  });

  it("treats an unterminated line as a prompt only once output has gone quiet", () => {
    const scanner = makeOmpLoginScanner();
    const events = scanner.push(CODE_PROMPT);
    expect(events).toEqual([
      { _tag: "progress", message: "Waiting for browser authentication..." },
    ]);
    expect(scanner.hasPendingTail()).toBe(true);
    expect(scanner.flush()).toEqual([
      {
        _tag: "prompt",
        message: "Paste the authorization code (or full redirect URL)",
        secret: false,
      },
    ]);
    expect(scanner.hasPendingTail()).toBe(false);
  });

  it("joins a line split across reads before deciding what it is", () => {
    const scanner = makeOmpLoginScanner();
    expect(scanner.push("\nOpen this URL in your browser:\nhttps://example.com/a")).toEqual([]);
    expect(scanner.push("?b=c\n\n")).toEqual([
      {
        _tag: "authorization",
        url: "https://example.com/a?b=c",
        instructions: null,
        userCode: null,
      },
    ]);
  });

  it("marks API key and token prompts secret and flushes an unfinished URL block", () => {
    const scanner = makeOmpLoginScanner();
    expect(scanner.push(DEEPSEEK_OUTPUT)).toEqual([
      {
        _tag: "authorization",
        url: "https://platform.deepseek.com/api_keys",
        instructions: "Create or copy your API key from the DeepSeek dashboard",
        userCode: null,
      },
    ]);
    expect(scanner.flush()).toEqual([
      { _tag: "prompt", message: "Paste your DeepSeek API key (sk-...)", secret: true },
    ]);
  });

  it("answers a question that arrives before any URL, as GitHub Copilot does", () => {
    const scanner = makeOmpLoginScanner();
    expect(
      scanner.push("GitHub Enterprise URL/domain (blank for github.com) (company.ghe.com): "),
    ).toEqual([]);
    expect(scanner.flush()).toEqual([
      {
        _tag: "prompt",
        message: "GitHub Enterprise URL/domain (blank for github.com) (company.ghe.com)",
        secret: false,
      },
    ]);
  });

  it("strips terminal colour and recognises the success line", () => {
    const scanner = makeOmpLoginScanner();
    expect(scanner.push("\u001b[32m\nLogged in to OpenRouter\u001b[39m\n")).toEqual([
      { _tag: "loggedIn" },
    ]);
  });

  it("reports why omp refused the login", () => {
    expect(parseOmpLoginFailure("\u001b[31mLogin failed: API key is required\u001b[39m\n")).toBe(
      "API key is required",
    );
    expect(parseOmpLoginFailure("warning only\n")).toBeNull();
  });
});

describe("omp login provider list", () => {
  it("keeps providers omp can log in to, in omp's order, and drops malformed or unavailable ones", () => {
    expect(
      parseOmpLoginProviders({
        providers: [
          { id: "openai-codex", name: "ChatGPT Plus/Pro", available: true, authenticated: true },
          { id: "hidden", name: "Hidden", available: false, authenticated: false },
          { id: "bad id", name: "Bad", available: true, authenticated: false },
          { id: "openai-codex", name: "Duplicate", available: true, authenticated: false },
          { id: "openrouter", name: "OpenRouter", available: true },
          { id: "anthropic", name: "Anthropic", available: true, authenticated: false },
        ],
      }),
    ).toEqual([
      { providerId: "openai-codex", name: "ChatGPT Plus/Pro", authenticated: true },
      { providerId: "anthropic", name: "Anthropic", authenticated: false },
    ]);
    expect(parseOmpLoginProviders({ unexpected: true })).toEqual([]);
  });

  it("reads credential ids and never needs the credentials themselves", () => {
    expect(
      parseOmpLogoutCredentialIds({
        accounts: [{ credentialId: 4, label: "a@b.c" }, { credentialId: "x" }, { credentialId: 9 }],
      }),
    ).toEqual([4, 9]);
  });
});

describe("omp login scanner against provider output omp prints today", () => {
  it("hides the server's credential path and recognises the success line", () => {
    const scanner = makeOmpLoginScanner();
    expect(
      scanner.push(
        "\nLogged in to Synthetic\nCredentials saved to /home/user/.omp/agent/agent.db\n",
      ),
    ).toEqual([{ _tag: "loggedIn" }]);
  });

  it("keeps device-code instructions other than the code line", () => {
    const scanner = makeOmpLoginScanner();
    expect(
      scanner.push(
        "\nOpen this URL in your browser:\nhttps://example.com/device\nEnter code: AB12-CD34\nApprove the request in the app.\n\n",
      ),
    ).toEqual([
      {
        _tag: "authorization",
        url: "https://example.com/device",
        instructions: "Approve the request in the app.",
        userCode: "AB12-CD34",
      },
    ]);
  });
});

describe("parseOmpLoginFailure", () => {
  it("keeps the provider's sentence and drops its JSON body", () => {
    expect(
      parseOmpLoginFailure(
        'Login failed: xAI API key validation failed (400): {"code":"invalid-argument","error":"Incorrect API key provided."}\n',
      ),
    ).toBe("xAI API key validation failed (400): Incorrect API key provided.");
    expect(
      parseOmpLoginFailure(
        'Login failed: deepseek API key validation failed (401): {"error":{"message":"Authentication Fails","type":"x"}}\n',
      ),
    ).toBe("deepseek API key validation failed (401): Authentication Fails");
  });

  it("returns plain reasons unchanged and ignores other stderr", () => {
    expect(parseOmpLoginFailure("Login failed: port 1455 is in use\n")).toBe("port 1455 is in use");
    expect(parseOmpLoginFailure("something else\n")).toBeNull();
  });
});
