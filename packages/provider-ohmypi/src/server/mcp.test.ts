import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { makeFakeSpawner } from "./loginHarness.testkit.ts";
import {
  buildMcpAddCommand,
  loopbackRedirectUri,
  makeMcpReauthScanner,
  parseMcpPrompts,
  parseMcpResources,
  parseMcpServers,
  parseMcpTest,
  quoteMcpToken,
  validateMcpCallback,
} from "./mcp.ts";
import { withOmpManagementSession } from "./process.ts";

// Outputs captured from omp 18.16 over `omp --mode rpc`.
describe("omp /mcp output", () => {
  it("lists servers with their transport, state and scope", () => {
    expect(
      parseMcpServers(
        [
          "atlassian | http | enabled | https://mcp.atlassian.com/v2/mcp [user]",
          "probe-stdio | stdio | disabled | npx [project]",
          "not a server line",
        ].join("\n"),
      ),
    ).toEqual([
      {
        name: "atlassian",
        transport: "http",
        enabled: true,
        target: "https://mcp.atlassian.com/v2/mcp",
        scope: "user",
      },
      { name: "probe-stdio", transport: "stdio", enabled: false, target: "npx", scope: "project" },
    ]);
    expect(parseMcpServers("No MCP servers configured.")).toEqual([]);
  });

  it("reads a connection test's tools, or omp's reason it failed", () => {
    expect(parseMcpTest('Server "e" connected (2 tools).\n  - echo\n  - get-env')).toEqual({
      connected: true,
      tools: ["echo", "get-env"],
    });
    expect(parseMcpTest('Connection to "a" failed: HTTP 401: {"error":"invalid_token"}')).toEqual({
      connected: false,
      tools: [],
      message: 'Connection to "a" failed: HTTP 401: {"error":"invalid_token"}',
    });
  });

  it("splits resources and prompts by server", () => {
    expect(
      parseMcpResources(
        "probe/demo://resource/static/document/architecture.md\nNo resources available on connected servers.",
      ),
    ).toEqual([{ server: "probe", uri: "demo://resource/static/document/architecture.md" }]);
    expect(
      parseMcpPrompts("probe/args-prompt \u2014 A prompt with two arguments\nprobe/simple-prompt"),
    ).toEqual([
      { server: "probe", name: "args-prompt", description: "A prompt with two arguments" },
      { server: "probe", name: "simple-prompt" },
    ]);
  });

  it("follows a reauthorization from its URL to how it ended", () => {
    const scanner = makeMcpReauthScanner();
    expect(scanner.push('Reauthorizing "atl"...')).toEqual([]);
    expect(scanner.push("Opening your browser to authorize. If it did not open:")).toEqual([]);
    expect(scanner.push("https://auth.example/authorize?redirect_uri=x")).toEqual([
      { _tag: "authorization", url: "https://auth.example/authorize?redirect_uri=x" },
    ]);
    expect(scanner.push('"atl" connected (52 tools). Server reconnected.')).toEqual([
      { _tag: "connected", toolCount: 52 },
    ]);
    expect(
      makeMcpReauthScanner().push(
        'Failed to reauthorize server "x": Could not discover OAuth endpoints from server response.',
      ),
    ).toEqual([
      { _tag: "failed", message: "Could not discover OAuth endpoints from server response." },
    ]);
  });
});

describe("omp /mcp arguments", () => {
  // omp groups quoted text literally and has no escapes; an empty "" is dropped.
  it("quotes only what omp can read back", () => {
    expect(quoteMcpToken("plain")).toBe("plain");
    expect(quoteMcpToken('say "hi"')).toBe(`'say "hi"'`);
    expect(quoteMcpToken("it's here")).toBe(`"it's here"`);
    expect(quoteMcpToken(`it's "both" here`)).toBeUndefined();
    expect(quoteMcpToken("")).toBeUndefined();
    expect(quoteMcpToken("a\nb")).toBeUndefined();
  });

  it("builds add commands per transport and refuses incomplete ones", () => {
    expect(
      buildMcpAddCommand({
        name: "e",
        scope: "project",
        transport: "stdio",
        command: ["node", "/tmp/a b/c.js"],
      }),
    ).toEqual({ ok: true, command: "/mcp add e --scope project -- node '/tmp/a b/c.js'" });
    expect(
      buildMcpAddCommand({
        name: "h",
        scope: "user",
        transport: "sse",
        url: "https://x.example/sse",
        token: "T",
      }),
    ).toEqual({
      ok: true,
      command: "/mcp add h --scope user --url https://x.example/sse --transport sse --token T",
    });
    expect(buildMcpAddCommand({ name: "h", scope: "user", transport: "http" }).ok).toBe(false);
    expect(
      buildMcpAddCommand({ name: "s", scope: "user", transport: "stdio", command: [] }).ok,
    ).toBe(false);
  });
});

describe("omp MCP authorization callback", () => {
  const redirect = loopbackRedirectUri(
    "https://auth.example/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A41234%2Fcallback",
  )!;

  it("only finishes on the flow's own loopback redirect", () => {
    expect(redirect.toString()).toBe("http://127.0.0.1:41234/callback");
    expect(
      validateMcpCallback(redirect, "http://127.0.0.1:41234/callback?code=c&state=s")?.toString(),
    ).toBe("http://127.0.0.1:41234/callback?code=c&state=s");
    for (const other of [
      "http://127.0.0.1:41235/callback?code=c",
      "http://example.com:41234/callback?code=c",
      "http://127.0.0.1:41234/other?code=c",
      "http://u:p@127.0.0.1:41234/callback?code=c",
      "not a url",
    ]) {
      expect(validateMcpCallback(redirect, other)).toBeUndefined();
    }
    expect(
      loopbackRedirectUri("https://auth.example/authorize?redirect_uri=https://evil.example/cb"),
    ).toBeUndefined();
  });
});

describe("omp management session", () => {
  it.live("aborts and fails a command that started the model", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { spawner, children } = yield* makeFakeSpawner((child, written) => {
          const command = JSON.parse(written) as { id: string; type: string };
          if (command.type === "abort") {
            return child.emit(
              `${JSON.stringify({ id: command.id, type: "response", success: true })}\n`,
            );
          }
          return child.emit(
            `${JSON.stringify({ id: command.id, type: "response", success: true, data: { agentInvoked: true } })}\n`,
          );
        });
        const failure = yield* withOmpManagementSession(
          { command: "omp", env: {}, cwd: "/tmp" },
          (session) => session.prompt("/mcp list"),
        ).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.flip,
        );
        expect(failure._tag).toBe("OmpProcessError");
        const written = (yield* Queue.clear(children[0]!.written)).map(
          (line) => (JSON.parse(line) as { type: string }).type,
        );
        expect(written).toEqual(["prompt", "abort"]);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});
