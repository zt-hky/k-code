import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/compat";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { OMP_EXTENSIONS_METHOD } from "./acp.ts";

const LOOKUP_TIMEOUT = Duration.seconds(15);
const MAX_SERVERS = 64;

const StringRecord = Schema.Record(Schema.String, Schema.Unknown);
const OmpMcpExtension = Schema.Struct({
  kind: Schema.Literal("mcp"),
  name: Schema.String,
  state: Schema.String,
  raw: Schema.optional(
    Schema.Struct({
      name: Schema.optional(Schema.String),
      enabled: Schema.optional(Schema.Boolean),
      transport: Schema.optional(Schema.String),
      type: Schema.optional(Schema.String),
      command: Schema.optional(Schema.String),
      args: Schema.optional(Schema.Array(Schema.Unknown)),
      env: Schema.optional(StringRecord),
      url: Schema.optional(Schema.String),
      headers: Schema.optional(StringRecord),
    }),
  ),
});
const decodeExtensions = Schema.decodeUnknownOption(
  Schema.Struct({ extensions: Schema.Array(Schema.Unknown) }),
);
const decodeMcpExtension = Schema.decodeUnknownOption(OmpMcpExtension);

const pairs = (record: Readonly<Record<string, unknown>> | undefined) =>
  Object.entries(record ?? {}).flatMap(([name, value]) =>
    typeof value === "string" ? [{ name, value }] : [],
  );

/** `_omp/extensions` response → the MCP servers omp would connect itself, as ACP server configs. */
export function ompConfiguredMcpServers(data: unknown): ReadonlyArray<EffectAcpSchema.McpServer> {
  const entries = Option.match(decodeExtensions(data), {
    onNone: () => [],
    onSome: (decoded) => decoded.extensions,
  });
  const servers: Array<EffectAcpSchema.McpServer> = [];
  for (const entry of entries) {
    const extension = Option.getOrUndefined(decodeMcpExtension(entry));
    const raw = extension?.raw;
    if (extension === undefined || raw === undefined) continue;
    if (extension.state !== "active" || raw.enabled === false) continue;
    const name = raw.name ?? extension.name;
    const transport = raw.transport ?? raw.type ?? (raw.command === undefined ? "http" : "stdio");
    if (transport === "stdio" && raw.command !== undefined) {
      servers.push({
        name,
        command: raw.command,
        args: (raw.args ?? []).filter((arg): arg is string => typeof arg === "string"),
        env: pairs(raw.env),
      });
    } else if ((transport === "http" || transport === "sse") && raw.url !== undefined) {
      servers.push({ type: transport, name, url: raw.url, headers: pairs(raw.headers) });
    }
    if (servers.length >= MAX_SERVERS) break;
  }
  return servers;
}

/**
 * omp's ACP mode connects only the MCP servers a client sends, never the ones the user configured
 * in omp, so they are read from omp and sent with the session. Failures fall back to none.
 */
export const readOmpConfiguredMcpServers = Effect.fn("OmpMcp.readConfiguredServers")(
  function* (input: {
    readonly cwd: string;
    readonly request: (
      method: string,
      payload: unknown,
    ) => Effect.Effect<unknown, EffectAcpErrors.AcpError>;
  }) {
    const response = yield* input.request(OMP_EXTENSIONS_METHOD, { cwd: input.cwd });
    return ompConfiguredMcpServers(response);
  },
  (effect) =>
    effect.pipe(
      Effect.timeoutOption(LOOKUP_TIMEOUT),
      Effect.map(Option.getOrElse((): ReadonlyArray<EffectAcpSchema.McpServer> => [])),
      Effect.catch((cause) =>
        Effect.logWarning("could not read omp's configured MCP servers", { cause }).pipe(
          Effect.as([]),
        ),
      ),
    ),
);
