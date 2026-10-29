// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { makeHarness, type FakeChild } from "./loginHarness.testkit.ts";

// Recorded from real `omp login <provider>` runs (omp 18.13.2, isolated HOME, stdin a pipe).
// `stdin` events mark where the recording answered a prompt; the answer text is not recorded.
const Fixture = Schema.Struct({
  provider: Schema.String,
  events: Schema.Array(
    Schema.Struct({
      t: Schema.Number,
      stream: Schema.Literals(["stdout", "stderr", "stdin", "exit"]),
      text: Schema.String,
    }),
  ),
});
const decodeFixture = Schema.decodeUnknownSync(Schema.fromJsonString(Fixture));
const loadFixture = (provider: string) =>
  decodeFixture(
    NodeFS.readFileSync(new URL(`./fixtures/login/${provider}.json`, import.meta.url), "utf8"),
  ).events;
type FixtureEvents = ReturnType<typeof loadFixture>;

/** Plays the recording up to the first answer (or to its end) and returns what follows. */
const play = (child: FakeChild, events: FixtureEvents) =>
  Effect.gen(function* () {
    let index = 0;
    for (; index < events.length; index++) {
      const event = events[index]!;
      if (event.stream === "stdin") break;
      if (event.stream === "stdout") yield* child.emit(event.text);
      else if (event.stream === "stderr") yield* child.emitStderr(event.text);
      else yield* child.exit(Number(event.text));
    }
    return events.slice(index + 1);
  });

const startFlow = (provider: string) =>
  Effect.gen(function* () {
    const h = yield* makeHarness();
    yield* h.login.start(provider);
    const child = yield* Queue.take(h.spawned);
    const rest = yield* play(child, loadFixture(provider));
    return { h, child, rest };
  });

it.live("classifies an OAuth flow that takes a pasted redirect (Anthropic)", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { h } = yield* startFlow("anthropic");
      const state = yield* h.waitFor((s) => s.kind !== null && s.prompt !== null);
      expect(state).toMatchObject({
        phase: "waiting",
        kind: "oauth",
        userCode: null,
        prompt: { message: "Paste the authorization code (or full redirect URL)", secret: false },
      });
      expect(state?.authorizationUrl).toMatch(/^https:\/\/claude\.ai\/oauth\/authorize\?/);
      // The loopback shortcut resolves on the omp machine only; it must not reach the client.
      expect(state?.instructions).toContain("Complete login in your browser");
      expect(state?.instructions).not.toContain("Local shortcut");
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.live("classifies an OAuth flow with no prompt (Cursor, ChatGPT)", () =>
  Effect.scoped(
    Effect.gen(function* () {
      for (const provider of ["cursor", "openai-codex"]) {
        const { h } = yield* startFlow(provider);
        const state = yield* h.waitFor((s) => s.kind !== null);
        expect(state).toMatchObject({ kind: "oauth", userCode: null });
        expect(state?.authorizationUrl).toMatch(/^https:\/\//);
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.live("keeps the prompt that shares a chunk with the progress line (Google)", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { h } = yield* startFlow("google-antigravity");
      const state = yield* h.waitFor((s) => s.kind !== null && s.prompt !== null);
      expect(state).toMatchObject({
        kind: "oauth",
        prompt: { message: "Paste the authorization code (or full redirect URL)", secret: false },
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.live("shows the device code apart from the instructions", () =>
  Effect.scoped(
    Effect.gen(function* () {
      for (const [provider, code, host] of [
        ["openai-codex-device", "O8JU-22U6A", "https://auth.openai.com/codex/device"],
        ["xai-oauth", "7GK3-NDGK", "https://accounts.x.ai/oauth2/device"],
      ] as const) {
        const { h } = yield* startFlow(provider);
        const state = yield* h.waitFor((s) => s.kind !== null);
        expect(state).toMatchObject({ kind: "device_code", userCode: code, prompt: null });
        expect(state?.authorizationUrl?.startsWith(host)).toBe(true);
        expect(state?.instructions ?? "").not.toContain("Enter code");
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.live("asks GitHub's enterprise question first, then shows the device code", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { h, child, rest } = yield* startFlow("github-copilot");
      const question = yield* h.waitFor((s) => s.prompt !== null);
      expect(question).toMatchObject({
        kind: null,
        authorizationUrl: null,
        prompt: {
          message: "GitHub Enterprise URL/domain (blank for github.com) (company.ghe.com)",
          secret: false,
        },
      });
      // Blank means github.com.
      yield* h.login.respond({
        flowId: question!.flowId!,
        promptId: question!.prompt!.id,
        value: "",
      });
      expect(yield* Queue.take(child.written)).toBe("\n");
      for (const event of rest) if (event.stream === "stdout") yield* child.emit(event.text);
      const device = yield* h.waitFor((s) => s.kind === "device_code");
      expect(device).toMatchObject({
        userCode: "DF49-33D3",
        authorizationUrl: "https://github.com/login/device",
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.live("treats a dashboard link plus a secret prompt as an API-key flow", () =>
  Effect.scoped(
    Effect.gen(function* () {
      for (const [provider, host] of [
        ["synthetic", "https://dev.synthetic.new/"],
        ["deepseek", "https://platform.deepseek.com/"],
        ["xai", "https://console.x.ai/"],
      ] as const) {
        const { h } = yield* startFlow(provider);
        const state = yield* h.waitFor((s) => s.kind !== null && s.prompt !== null);
        expect(state).toMatchObject({ kind: "api_key", userCode: null, prompt: { secret: true } });
        expect(state?.authorizationUrl?.startsWith(host)).toBe(true);
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.live("signs in with an API key without echoing the server's credential path", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { h, child, rest } = yield* startFlow("synthetic");
      const prompted = yield* h.waitFor((s) => s.prompt !== null);
      yield* h.login.respond({
        flowId: prompted!.flowId!,
        promptId: prompted!.prompt!.id,
        value: "sk-dummy",
      });
      expect(yield* Queue.take(child.written)).toBe("sk-dummy\n");
      for (const event of rest) {
        if (event.stream === "stdout") yield* child.emit(event.text);
        else if (event.stream === "exit") yield* child.exit(Number(event.text));
      }
      const done = yield* h.waitFor((s) => s.phase === "succeeded");
      expect(done).toMatchObject({ kind: null, prompt: null, message: null });
      expect(yield* Ref.get(h.changed)).toBe(1);
      const seen = JSON.stringify(yield* Ref.get(h.seen));
      expect(seen).not.toContain("Credentials saved");
      expect(seen).not.toContain("/home/user");
      expect(seen).not.toContain("sk-dummy");
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.live("reports a rejected key by the provider's own message, not its JSON body", () =>
  Effect.scoped(
    Effect.gen(function* () {
      for (const [provider, expected] of [
        ["deepseek", "Authentication Fails"],
        ["xai", "Incorrect API key provided"],
      ] as const) {
        const { h, rest } = yield* startFlow(provider);
        const prompted = yield* h.waitFor((s) => s.prompt !== null);
        yield* h.login.respond({
          flowId: prompted!.flowId!,
          promptId: prompted!.prompt!.id,
          value: "bad",
        });
        const child = h.children.at(-1)!;
        for (const event of rest) {
          if (event.stream === "stdout") yield* child.emit(event.text);
          else if (event.stream === "stderr") yield* child.emitStderr(event.text);
          else if (event.stream === "exit") yield* child.exit(Number(event.text));
        }
        const failed = yield* h.waitFor((s) => s.phase === "failed");
        expect(failed?.message).toContain(expected);
        expect(failed?.message).not.toContain("{");
        expect(yield* Ref.get(h.changed)).toBe(0);
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);
