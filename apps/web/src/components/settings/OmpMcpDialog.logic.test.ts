import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_MCP_SERVER_DRAFT,
  buildAddServerInput,
  filterMcpServers,
  isValidMcpServerName,
  splitCommandLine,
  visibleMcpAuthState,
} from "./OmpMcpDialog.logic";

describe("splitCommandLine", () => {
  it("splits on whitespace", () => {
    expect(splitCommandLine("  npx  -y @pkg/server ")).toEqual({
      ok: true,
      tokens: ["npx", "-y", "@pkg/server"],
    });
  });
  it("keeps quoted text literal, with no escapes", () => {
    expect(splitCommandLine(`node "my dir/s.js" --msg 'it said "hi"' a\\ b`)).toEqual({
      ok: true,
      tokens: ["node", "my dir/s.js", "--msg", 'it said "hi"', "a\\", "b"],
    });
  });
  it("joins adjacent quoted and bare text", () => {
    expect(splitCommandLine(`--flag="a b"`)).toEqual({ ok: true, tokens: ["--flag=a b"] });
  });
  it("rejects unterminated quotes and empty arguments", () => {
    expect(splitCommandLine(`npx "oops`).ok).toBe(false);
    expect(splitCommandLine(`npx ""`).ok).toBe(false);
  });
  it("returns no tokens for a blank line", () => {
    expect(splitCommandLine("   ")).toEqual({ ok: true, tokens: [] });
  });
});

describe("isValidMcpServerName", () => {
  it("accepts names omp can remove again", () => {
    expect(isValidMcpServerName("atlassian")).toBe(true);
    expect(isValidMcpServerName("probe-stdio_2.v1")).toBe(true);
  });
  it("rejects spaces, leading punctuation, and empty names", () => {
    expect(isValidMcpServerName("")).toBe(false);
    expect(isValidMcpServerName("my server")).toBe(false);
    expect(isValidMcpServerName("-x")).toBe(false);
    expect(isValidMcpServerName("a".repeat(129))).toBe(false);
  });
});

describe("buildAddServerInput", () => {
  const instanceId = ProviderInstanceId.make("ohmypi");
  const target = { instanceId, projectId: null };

  it("builds an http server with an optional token", () => {
    const built = buildAddServerInput(
      { ...EMPTY_MCP_SERVER_DRAFT, name: "n", url: " https://x/mcp ", token: " T " },
      target,
    );
    expect(built).toEqual({
      ok: true,
      input: {
        instanceId,
        name: "n",
        scope: "user",
        transport: "http",
        url: "https://x/mcp",
        token: "T",
      },
    });
  });
  it("builds a stdio server from the command line", () => {
    const built = buildAddServerInput(
      { ...EMPTY_MCP_SERVER_DRAFT, name: "n", transport: "stdio", commandLine: "npx -y @pkg" },
      target,
    );
    expect(built.ok && built.input.command).toEqual(["npx", "-y", "@pkg"]);
  });
  it("needs a project for project scope", () => {
    const built = buildAddServerInput(
      { ...EMPTY_MCP_SERVER_DRAFT, name: "n", scope: "project", url: "https://x/mcp" },
      target,
    );
    expect(built.ok).toBe(false);
  });
  it("rejects bad names and urls", () => {
    expect(buildAddServerInput({ ...EMPTY_MCP_SERVER_DRAFT, name: "a b" }, target).ok).toBe(false);
    expect(
      buildAddServerInput({ ...EMPTY_MCP_SERVER_DRAFT, name: "n", url: "ftp://x" }, target).ok,
    ).toBe(false);
  });
});

describe("filterMcpServers", () => {
  const servers = [
    { name: "atlassian", transport: "http", enabled: true, target: "https://a/mcp", scope: "user" },
    { name: "probe", transport: "stdio", enabled: false, target: "npx", scope: "project" },
  ] as const;
  it("matches name, transport, scope, and target", () => {
    expect(filterMcpServers(servers, "ATL")).toHaveLength(1);
    expect(filterMcpServers(servers, "stdio")[0]?.name).toBe("probe");
    expect(filterMcpServers(servers, "npx")[0]?.name).toBe("probe");
    expect(filterMcpServers(servers, "")).toHaveLength(2);
  });
});

describe("visibleMcpAuthState", () => {
  const state = {
    instanceId: ProviderInstanceId.make("ohmypi"),
    phase: "waiting",
    flowId: "f1",
    server: "n",
    authorizationUrl: null,
    toolCount: null,
    message: null,
  } as const;
  it("shows only the flow this client started and has not dismissed", () => {
    expect(visibleMcpAuthState(state, "f1", null)).toBe(state);
    expect(visibleMcpAuthState(state, "other", null)).toBeNull();
    expect(visibleMcpAuthState(state, "f1", "f1")).toBeNull();
  });
});
