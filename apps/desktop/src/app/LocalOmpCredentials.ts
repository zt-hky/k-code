// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Short-lived `omp auth export` child with bounded output and deadline.
import * as NodeChildProcess from "node:child_process";
import * as Schema from "effect/Schema";

const EXPORT_TIMEOUT_MS = 20_000;
const EXPORT_MAX_BYTES = 1_000_000;

export type LocalOmpCredentialsResult =
  | {
      readonly status: "ok";
      /** The provider ids the export holds, shown before anything leaves this computer. */
      readonly providerIds: ReadonlyArray<string>;
      /** `omp auth export` output, exactly as `omp auth import -` reads it. A secret. */
      readonly payload: string;
    }
  | { readonly status: "not_installed" }
  | { readonly status: "empty" }
  | { readonly status: "failed"; readonly message: string };

export type OmpExportRunner = (
  platform: NodeJS.Platform,
) => Promise<
  | { readonly kind: "exited"; readonly code: number; readonly stdout: string }
  | { readonly kind: "not_found" }
  | { readonly kind: "failed" }
>;

const Export = Schema.Struct({
  credentials: Schema.Array(Schema.Struct({ provider: Schema.String })),
});
const decodeExport = Schema.decodeUnknownOption(Schema.fromJsonString(Export));

const runOmpExport: OmpExportRunner = (platform) =>
  new Promise((resolve) => {
    NodeChildProcess.execFile(
      "omp",
      ["auth", "export"],
      {
        timeout: EXPORT_TIMEOUT_MS,
        maxBuffer: EXPORT_MAX_BYTES,
        windowsHide: true,
        // `omp` is a `.cmd` shim on Windows.
        shell: platform === "win32",
      },
      (error, stdout) => {
        if (error === null) return resolve({ kind: "exited", code: 0, stdout });
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return resolve({ kind: "not_found" });
        return resolve(
          typeof code === "number" ? { kind: "exited", code, stdout } : { kind: "failed" },
        );
      },
    );
  });

/**
 * Reads this computer's Oh My Pi sign-ins with its own `omp auth export`. The output holds API
 * keys and OAuth refresh tokens: it is returned to the caller and never logged or kept here.
 */
export async function readLocalOmpCredentials(
  platform: NodeJS.Platform,
  run: OmpExportRunner = runOmpExport,
): Promise<LocalOmpCredentialsResult> {
  const result = await run(platform);
  if (result.kind === "not_found") return { status: "not_installed" };
  if (result.kind === "failed" || result.code !== 0) {
    return {
      status: "failed",
      message: "Oh My Pi on this computer could not export its sign-ins.",
    };
  }
  const decoded = decodeExport(result.stdout);
  if (decoded._tag === "None") {
    return {
      status: "failed",
      message: "Oh My Pi on this computer returned sign-ins in a format T3 Code does not know.",
    };
  }
  const providerIds = [...new Set(decoded.value.credentials.map((entry) => entry.provider))];
  if (providerIds.length === 0) return { status: "empty" };
  return { status: "ok", providerIds, payload: result.stdout };
}
