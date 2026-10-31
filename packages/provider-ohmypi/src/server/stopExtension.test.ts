// @effect-diagnostics nodeBuiltinImport:off -- the omp extension runs outside Effect; this test drives its native boundary.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeVM from "node:vm";
import { afterEach, describe, expect, it, vi } from "@effect/vitest";

import {
  OMP_STOP_EXTENSION_SOURCE,
  ompSubagentStopMarkerName,
  T3_OMP_STOP_DIR_ENV,
} from "./stopExtension.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<void>;

const loadExtension = (env: Record<string, string>) => {
  const handlers = new Map<string, Handler>();
  const source = OMP_STOP_EXTENSION_SOURCE.replace(/^import .*;$/gm, "").replace(
    "export default function",
    "function",
  );
  NodeVM.runInNewContext(`${source}\nt3StopExtension(pi)`, {
    process: { env },
    createHash: NodeCrypto.createHash,
    existsSync: NodeFS.existsSync,
    rmSync: NodeFS.rmSync,
    join: NodePath.join,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    pi: { on: (name: string, handler: Handler) => handlers.set(name, handler) },
  });
  return handlers;
};

describe("omp stop extension", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts only the subagent whose session file the marker names", async () => {
    vi.useFakeTimers();
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-omp-ext-"));
    const sessionFile = "/agent/sessions/-repo/stamp_s1/0-Scout.jsonl";
    const aborted: string[] = [];
    const handlers = loadExtension({ [T3_OMP_STOP_DIR_ENV]: dir });
    const ctx = (kind: string) => ({
      agent: { kind },
      sessionManager: { getSessionFile: () => sessionFile },
      abort: () => aborted.push(kind),
    });
    try {
      await handlers.get("agent_start")!({}, ctx("sub"));
      NodeFS.writeFileSync(NodePath.join(dir, ompSubagentStopMarkerName("/other.jsonl")), "");
      vi.advanceTimersByTime(1_000);
      expect(aborted).toEqual([]);
      const marker = NodePath.join(dir, ompSubagentStopMarkerName(sessionFile));
      NodeFS.writeFileSync(marker, "");
      vi.advanceTimersByTime(1_000);
      expect(aborted).toEqual(["sub"]);
      expect(NodeFS.existsSync(marker)).toBe(false);
      await handlers.get("agent_end")!({}, ctx("sub"));
      NodeFS.writeFileSync(marker, "");
      vi.advanceTimersByTime(1_000);
      expect(aborted).toEqual(["sub"]);
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never watches the parent agent", async () => {
    vi.useFakeTimers();
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-omp-ext-"));
    const sessionFile = "/agent/sessions/-repo/stamp_s1.jsonl";
    const aborted: string[] = [];
    const handlers = loadExtension({ [T3_OMP_STOP_DIR_ENV]: dir });
    try {
      await handlers.get("agent_start")!(
        {},
        {
          agent: { kind: "main" },
          sessionManager: { getSessionFile: () => sessionFile },
          abort: () => aborted.push("main"),
        },
      );
      NodeFS.writeFileSync(NodePath.join(dir, ompSubagentStopMarkerName(sessionFile)), "");
      vi.advanceTimersByTime(1_000);
      expect(aborted).toEqual([]);
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("registers nothing without a stop directory", () => {
    expect(loadExtension({}).size).toBe(0);
  });
});
