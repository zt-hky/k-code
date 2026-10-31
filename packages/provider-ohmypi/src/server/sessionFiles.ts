import { stripLeadingPrivateUse } from "@t3tools/provider-acp-registry/server/probe";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";

/** omp reserves the first line of every session file for a fixed-width title slot. */
export const OMP_TITLE_SLOT_BYTES = 256;
const FIRST_MESSAGE_PREFIX_BYTES = 16 * 1024;
const FIRST_MESSAGE_MAX_CHARS = 100;
const FILE_READ_CONCURRENCY = 8;
const SESSION_FILE_EXTENSION = ".jsonl";

type OmpTitleSource = "auto" | "user";

export interface OmpTitleSlot {
  readonly title: string;
  readonly source: OmpTitleSource | undefined;
  readonly updatedAt: string;
}

const utf8Encoder = new TextEncoder();
const byteLength = (value: string): number => utf8Encoder.encode(value).byteLength;

const slotLine = (title: string, source: OmpTitleSource, updatedAt: string, pad: string): string =>
  `${JSON.stringify({ type: "title", v: 1, title, source, updatedAt, pad })}\n`;

// Mirrors omp's truncateTitleForSlot: the longest code-point prefix that still fits unpadded.
const truncateTitleForSlot = (title: string, source: OmpTitleSource, updatedAt: string): string => {
  const codePoints = [...title];
  let low = 0;
  let high = codePoints.length;
  let best = "";
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const candidate = codePoints.slice(0, mid).join("");
    if (byteLength(slotLine(candidate, source, updatedAt, "")) <= OMP_TITLE_SLOT_BYTES) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
};

/** Mirrors omp's serializeTitleSlot: exactly 256 UTF-8 bytes including the newline. */
export const serializeOmpTitleSlot = (input: {
  readonly title: string;
  readonly source: OmpTitleSource;
  readonly updatedAt: string;
}): { readonly line: string; readonly title: string } => {
  const title = truncateTitleForSlot(input.title, input.source, input.updatedAt);
  const unpadded = slotLine(title, input.source, input.updatedAt, "");
  const padBytes = OMP_TITLE_SLOT_BYTES - byteLength(unpadded);
  if (padBytes < 0) throw new Error("Session title slot metadata exceeds fixed slot size");
  const line = slotLine(title, input.source, input.updatedAt, " ".repeat(padBytes));
  if (byteLength(line) !== OMP_TITLE_SLOT_BYTES) {
    throw new Error("Session title slot serialization failed to produce fixed-width output");
  }
  return { line, title };
};

/** Parses the first 256 bytes of a session file; undefined unless they are a valid v1 slot. */
export const parseOmpTitleSlot = (bytes: Uint8Array): OmpTitleSlot | undefined => {
  if (bytes.byteLength !== OMP_TITLE_SLOT_BYTES || bytes[OMP_TITLE_SLOT_BYTES - 1] !== 0x0a) {
    return undefined;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, OMP_TITLE_SLOT_BYTES - 1),
    );
    const record: unknown = JSON.parse(text);
    if (typeof record !== "object" || record === null) return undefined;
    const slot = record as Record<string, unknown>;
    if (slot.type !== "title" || slot.v !== 1) return undefined;
    if (
      typeof slot.title !== "string" ||
      typeof slot.updatedAt !== "string" ||
      typeof slot.pad !== "string"
    ) {
      return undefined;
    }
    if (slot.source !== undefined && slot.source !== "auto" && slot.source !== "user") {
      return undefined;
    }
    return { title: slot.title, source: slot.source, updatedAt: slot.updatedAt };
  } catch {
    return undefined;
  }
};

// T3 sends `<t3_code_instructions>…<user_request>text</user_request>` and context handoffs
// end in `User message:\ntext`; the title is the user's own text.
const userRequestText = (value: string): string => {
  const request = /<user_request>\s*([\s\S]*?)(?:<\/user_request>|$)/.exec(value)?.[1];
  if (request !== undefined) return request;
  if (!value.startsWith("Context handoff (")) return value;
  const marker = value.lastIndexOf("\n\nUser message:\n");
  return marker === -1 ? value : value.slice(marker + "\n\nUser message:\n".length);
};

const singleLine = (value: string): string =>
  stripLeadingPrivateUse(
    (userRequestText(value).trim().split(/\r?\n/)[0] ?? "").replace(/[\x00-\x1F\x7F]/g, "").trim(),
  ).trim();

const messageText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part: unknown) => {
      const record =
        typeof part === "object" && part !== null ? (part as Record<string, unknown>) : {};
      return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
    })
    .join("\n");
};

// A very long first message can cut the last line of the prefix window mid-JSON.
const truncatedUserText = (line: string): string | undefined => {
  const match = /"role":"user","content":(?:\[\{"type":"text","text":)?"((?:[^"\\]|\\.)*)/.exec(
    line,
  );
  if (match?.[1] === undefined) return undefined;
  let captured = match[1];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return JSON.parse(`"${captured}"`) as string;
    } catch {
      captured = captured.replace(/\\(?:u[0-9a-fA-F]{0,3})?$/, "");
    }
  }
  return undefined;
};

/** First user prompt of an omp session, from the already-read file prefix. */
export const firstUserMessageFromPrefix = (
  prefix: string,
  complete: boolean,
): string | undefined => {
  const lines = prefix.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.length === 0 || !line.includes('"role":"user"')) continue;
    const isCutOff = !complete && index === lines.length - 1;
    let text: string | undefined;
    try {
      const entry: unknown = JSON.parse(line);
      const record =
        typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
      const message =
        typeof record.message === "object" && record.message !== null
          ? (record.message as Record<string, unknown>)
          : {};
      if (record.type !== "message" || message.role !== "user") continue;
      if (message.attribution !== undefined && message.attribution !== "user") continue;
      text = messageText(message.content);
    } catch {
      text = isCutOff ? truncatedUserText(line) : undefined;
    }
    const title =
      text === undefined ? "" : [...singleLine(text)].slice(0, FIRST_MESSAGE_MAX_CHARS).join("");
    if (title.length > 0) return title;
  }
  return undefined;
};

export const ompAgentDir = (
  environment: Readonly<Record<string, string | undefined>>,
  path: Path.Path,
): string | undefined =>
  environment.PI_CODING_AGENT_DIR ??
  (environment.HOME === undefined ? undefined : path.join(environment.HOME, ".omp", "agent"));

export function makeOmpSessionFiles(input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly agentDir: string;
}) {
  const { fileSystem, path } = input;
  const sessionsRoot = path.join(input.agentDir, "sessions");

  // Session files are `<sessionsRoot>/<encoded cwd>/<stamp>_<sessionId>.jsonl`.
  const findSessionFiles = Effect.fn("OmpSessionFiles.find")(function* (
    sessionIds: ReadonlyArray<string>,
  ) {
    const wanted = new Map(
      sessionIds.map((sessionId) => [`_${sessionId}${SESSION_FILE_EXTENSION}`, sessionId]),
    );
    const found = new Map<string, string>();
    if (wanted.size === 0) return found;
    const projects = yield* fileSystem
      .readDirectory(sessionsRoot)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    for (const project of projects) {
      const projectDir = path.join(sessionsRoot, project);
      const names = yield* fileSystem
        .readDirectory(projectDir)
        .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
      for (const name of names) {
        if (!name.endsWith(SESSION_FILE_EXTENSION)) continue;
        for (const [suffix, sessionId] of wanted) {
          if (name.endsWith(suffix) && !found.has(sessionId)) {
            found.set(sessionId, path.join(projectDir, name));
          }
        }
      }
      if (found.size === wanted.size) break;
    }
    return found;
  });

  const readPrefix = (file: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* fileSystem.open(file, { flag: "r" });
        const bytes = Option.getOrUndefined(yield* handle.readAlloc(FIRST_MESSAGE_PREFIX_BYTES));
        return bytes === undefined
          ? undefined
          : {
              text: new TextDecoder().decode(bytes),
              complete: bytes.byteLength < FIRST_MESSAGE_PREFIX_BYTES,
            };
      }),
    );

  /** First user message per session id, for sessions omp has not titled. Best-effort. */
  const readFirstMessages = Effect.fn("OmpSessionFiles.readFirstMessages")(function* (
    sessionIds: ReadonlyArray<string>,
  ) {
    const files = yield* findSessionFiles(sessionIds);
    const messages = new Map<string, string>();
    yield* Effect.forEach(
      files,
      ([sessionId, file]) =>
        readPrefix(file).pipe(
          Effect.tap((prefix) =>
            Effect.sync(() => {
              const message =
                prefix === undefined
                  ? undefined
                  : firstUserMessageFromPrefix(prefix.text, prefix.complete);
              if (message !== undefined) messages.set(sessionId, message);
            }),
          ),
          Effect.ignore,
        ),
      { concurrency: FILE_READ_CONCURRENCY, discard: true },
    );
    return messages as ReadonlyMap<string, string>;
  });

  /**
   * Rewrites only omp's fixed-width title slot in place. Returns whether bytes were written;
   * a missing file, an unrecognized first line, or an unchanged title writes nothing.
   */
  const writeSessionTitle = Effect.fn("OmpSessionFiles.writeSessionTitle")(function* (request: {
    readonly sessionId: string;
    readonly title: string;
    readonly updatedAt: string;
  }) {
    const file = (yield* findSessionFiles([request.sessionId])).get(request.sessionId);
    if (file === undefined) return false;
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* fileSystem.open(file, { flag: "r+" });
        const head = Option.getOrUndefined(yield* handle.readAlloc(OMP_TITLE_SLOT_BYTES));
        const current = head === undefined ? undefined : parseOmpTitleSlot(head);
        if (current === undefined) return false;
        const next = serializeOmpTitleSlot({
          title: request.title,
          source: "user",
          updatedAt: request.updatedAt,
        });
        if (current.title === next.title || stripLeadingPrivateUse(current.title) === next.title) {
          return false;
        }
        yield* handle.seek(0n, "start");
        yield* handle.writeAll(utf8Encoder.encode(next.line));
        return true;
      }),
    );
  });

  return { readFirstMessages, writeSessionTitle };
}
