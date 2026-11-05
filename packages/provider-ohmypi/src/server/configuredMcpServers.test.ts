import { describe, expect, it } from "@effect/vitest";

import { ompConfiguredMcpServers } from "./configuredMcpServers.ts";

const source = { provider: "native", providerName: "OMP", level: "user" };

describe("omp configured MCP servers", () => {
  // `_omp/extensions` entries as omp 18.16 returns them.
  it("sends the servers omp would connect itself and skips disabled or shadowed ones", () => {
    expect(
      ompConfiguredMcpServers({
        extensions: [
          { kind: "skill", name: "frontend-design", state: "active" },
          {
            kind: "mcp",
            name: "everything",
            state: "active",
            raw: {
              name: "everything",
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-everything"],
              env: { API_KEY: "k", IGNORED: 3 },
              transport: "stdio",
              _source: source,
            },
          },
          {
            kind: "mcp",
            name: "atlassian",
            state: "active",
            raw: {
              name: "atlassian",
              enabled: true,
              url: "https://mcp.atlassian.com/v2/mcp",
              headers: { Authorization: "Bearer t" },
              transport: "http",
            },
          },
          {
            kind: "mcp",
            name: "events",
            state: "active",
            raw: { name: "events", url: "https://x.example/sse", transport: "sse" },
          },
          {
            kind: "mcp",
            name: "off",
            state: "active",
            raw: { name: "off", enabled: false, command: "node", transport: "stdio" },
          },
          {
            kind: "mcp",
            name: "plugin:dup",
            state: "disabled",
            raw: { name: "plugin:dup", command: "node" },
          },
          { kind: "mcp", name: "shadowed", state: "shadowed", raw: { command: "node" } },
        ],
      }),
    ).toEqual([
      {
        name: "everything",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-everything"],
        env: [{ name: "API_KEY", value: "k" }],
      },
      {
        type: "http",
        name: "atlassian",
        url: "https://mcp.atlassian.com/v2/mcp",
        headers: [{ name: "Authorization", value: "Bearer t" }],
      },
      { type: "sse", name: "events", url: "https://x.example/sse", headers: [] },
    ]);
    expect(ompConfiguredMcpServers({ unexpected: true })).toEqual([]);
  });
});
