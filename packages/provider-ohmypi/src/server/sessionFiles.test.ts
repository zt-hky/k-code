import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  OMP_TITLE_SLOT_BYTES,
  firstUserMessageFromPrefix,
  makeOmpSessionFiles,
  parseOmpTitleSlot,
  serializeOmpTitleSlot,
} from "./sessionFiles.ts";

const encoder = new TextEncoder();
const UPDATED_AT = "2026-01-02T03:04:05.000Z";

const userLine = (content: unknown, attribution?: string) =>
  `${JSON.stringify({
    type: "message",
    id: "m1",
    message: { role: "user", content, ...(attribution === undefined ? {} : { attribution }) },
  })}\n`;

const body = (...lines: ReadonlyArray<string>) =>
  [`${JSON.stringify({ type: "session", version: 3, id: "s1", cwd: "/repo" })}\n`, ...lines].join(
    "",
  );

const sessionFile = (title: string, rest: string, source: "auto" | "user" = "auto") =>
  serializeOmpTitleSlot({ title, source, updatedAt: UPDATED_AT }).line + rest;

const setup = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const agentDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-omp-sessions-" });
  const projectDir = path.join(agentDir, "sessions", "-repo");
  yield* fileSystem.makeDirectory(projectDir, { recursive: true });
  const files = makeOmpSessionFiles({ fileSystem, path, agentDir });
  const write = (sessionId: string, contents: string) => {
    const file = path.join(projectDir, `2026-01-01T00-00-00-000Z_${sessionId}.jsonl`);
    return fileSystem.writeFile(file, encoder.encode(contents)).pipe(Effect.as(file));
  };
  return { fileSystem, files, write };
});

describe("omp title slot", () => {
  it("serializes to exactly 256 bytes and truncates long titles by code point", () => {
    const short = serializeOmpTitleSlot({
      title: "Fix tests",
      source: "user",
      updatedAt: UPDATED_AT,
    });
    expect(encoder.encode(short.line).byteLength).toBe(OMP_TITLE_SLOT_BYTES);
    expect(parseOmpTitleSlot(encoder.encode(short.line))).toEqual({
      title: "Fix tests",
      source: "user",
      updatedAt: UPDATED_AT,
    });

    const long = serializeOmpTitleSlot({
      title: "界".repeat(500),
      source: "user",
      updatedAt: UPDATED_AT,
    });
    expect(encoder.encode(long.line).byteLength).toBe(OMP_TITLE_SLOT_BYTES);
    expect(long.title.length).toBeGreaterThan(0);
    expect(long.title.length).toBeLessThan(500);
    expect(parseOmpTitleSlot(encoder.encode(long.line))?.title).toBe(long.title);
  });

  it("rejects first lines that are not a full v1 slot", () => {
    const slot = serializeOmpTitleSlot({ title: "x", source: "auto", updatedAt: UPDATED_AT }).line;
    expect(parseOmpTitleSlot(encoder.encode(slot.slice(0, 100)))).toBeUndefined();
    expect(parseOmpTitleSlot(encoder.encode(slot.replace('"v":1', '"v":2')))).toBeUndefined();
    expect(parseOmpTitleSlot(encoder.encode(slot.replace("title", "other")))).toBeUndefined();
  });
});

describe("omp first user message", () => {
  it("reads text parts, skips agent-attributed prompts, and strips glyph prefixes", () => {
    const prefix = body(
      userLine("ignored", "agent"),
      userLine([{ type: "text", text: "\uE0A0  Fix the flaky test\nmore detail" }]),
    );
    expect(firstUserMessageFromPrefix(prefix, true)).toBe("Fix the flaky test");
  });

  it("clips to 100 characters", () => {
    expect(firstUserMessageFromPrefix(body(userLine("a".repeat(300))), true)).toBe("a".repeat(100));
  });

  it("shows the user's request instead of the instructions T3 wraps around it", () => {
    const wrapped =
      "<t3_code_instructions>\n## K-code interaction mode: Default\n</t3_code_instructions>\n\n<user_request>\nAdd a resume dialog\n</user_request>";
    expect(firstUserMessageFromPrefix(body(userLine(wrapped)), true)).toBe("Add a resume dialog");
    const handoff =
      "Context handoff (manual_context):\nFrom thread t1\n\nUser message:\nKeep going";
    expect(firstUserMessageFromPrefix(body(userLine(handoff)), true)).toBe("Keep going");
  });

  it("recovers the text of a message cut off by the read window", () => {
    const whole = userLine("Refactor the sidebar please, with a very long explanation");
    const cut = whole.slice(0, whole.length - 25);
    expect(firstUserMessageFromPrefix(body(cut), false)).toBe(
      "Refactor the sidebar please, with a",
    );
    expect(firstUserMessageFromPrefix(body(cut), true)).toBeUndefined();
  });

  it.effect("finds the first message of sessions by id across project directories", () =>
    Effect.gen(function* () {
      const { files, write } = yield* setup;
      yield* write("s1", sessionFile("", body(userLine("Hello omp"))));
      yield* write("s2", sessionFile("", body()));
      const messages = yield* files.readFirstMessages(["s1", "s2", "missing"]);
      expect([...messages]).toEqual([["s1", "Hello omp"]]);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});

describe("omp title write-back", () => {
  it.effect("rewrites only the title slot, byte-for-byte elsewhere", () =>
    Effect.gen(function* () {
      const { fileSystem, files, write } = yield* setup;
      const rest = body(userLine("héllo 世界"), userLine("second"));
      const file = yield* write("s1", sessionFile("Old title", rest));
      const before = yield* fileSystem.readFile(file);

      const written = yield* files.writeSessionTitle({
        sessionId: "s1",
        title: "New title",
        updatedAt: "2026-02-02T00:00:00.000Z",
      });
      const after = yield* fileSystem.readFile(file);

      expect(written).toBe(true);
      expect(after.byteLength).toBe(before.byteLength);
      expect(after.subarray(OMP_TITLE_SLOT_BYTES)).toEqual(before.subarray(OMP_TITLE_SLOT_BYTES));
      expect(parseOmpTitleSlot(after.subarray(0, OMP_TITLE_SLOT_BYTES))).toEqual({
        title: "New title",
        source: "user",
        updatedAt: "2026-02-02T00:00:00.000Z",
      });
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("truncates long titles to the slot", () =>
    Effect.gen(function* () {
      const { fileSystem, files, write } = yield* setup;
      const file = yield* write("s1", sessionFile("Old", body()));
      const size = (yield* fileSystem.readFile(file)).byteLength;
      yield* files.writeSessionTitle({
        sessionId: "s1",
        title: "x".repeat(1_000),
        updatedAt: UPDATED_AT,
      });
      const after = yield* fileSystem.readFile(file);
      expect(after.byteLength).toBe(size);
      const title = parseOmpTitleSlot(after.subarray(0, OMP_TITLE_SLOT_BYTES))?.title ?? "";
      expect(title.length).toBeGreaterThan(100);
      expect(title.length).toBeLessThan(256);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("skips titles omp already has, ignoring its glyph prefix", () =>
    Effect.gen(function* () {
      const { fileSystem, files, write } = yield* setup;
      const file = yield* write("s1", sessionFile("\uE0A0 Same title", body()));
      const before = yield* fileSystem.readFile(file);
      const written = yield* files.writeSessionTitle({
        sessionId: "s1",
        title: "Same title",
        updatedAt: "2026-03-03T00:00:00.000Z",
      });
      expect(written).toBe(false);
      expect(yield* fileSystem.readFile(file)).toEqual(before);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("writes nothing when line 1 is not a title slot or the session is unknown", () =>
    Effect.gen(function* () {
      const { fileSystem, files, write } = yield* setup;
      const legacy = body(userLine("legacy file without a slot"));
      const file = yield* write("legacy", legacy);
      expect(
        yield* files.writeSessionTitle({ sessionId: "legacy", title: "T", updatedAt: UPDATED_AT }),
      ).toBe(false);
      expect(new TextDecoder().decode(yield* fileSystem.readFile(file))).toBe(legacy);
      expect(
        yield* files.writeSessionTitle({ sessionId: "unknown", title: "T", updatedAt: UPDATED_AT }),
      ).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});
