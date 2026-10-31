import {
  DEFAULT_CLIENT_SETTINGS,
  isSyncedClientSettingKey,
  type ClientSettings,
  type ClientSettingsPatch,
  type ClientSettingsSyncSnapshot,
  type SyncedClientSettingsPatch,
} from "@t3tools/contracts";
import { stableStringify } from "@t3tools/shared/relaySigning";

/** Keeps only the keys that sync through the server; the rest stay on this device. */
export function pickSyncedClientPatch(patch: ClientSettingsPatch): SyncedClientSettingsPatch {
  return Object.fromEntries(
    Object.entries(patch).filter(
      ([key, value]) => value !== undefined && isSyncedClientSettingKey(key),
    ),
  ) as SyncedClientSettingsPatch;
}

/** The synced keys where `next` differs from `current`, as a patch that turns one into the other. */
export function diffSyncedClientSettings(
  current: ClientSettings,
  next: ClientSettings,
): SyncedClientSettingsPatch {
  return Object.fromEntries(
    Object.entries(next).filter(
      ([key, value]) =>
        isSyncedClientSettingKey(key) &&
        stableStringify(value) !== stableStringify(current[key as keyof ClientSettings]),
    ),
  ) as SyncedClientSettingsPatch;
}

export type ClientSettingsSyncStep =
  | { readonly kind: "none" }
  /** The server holds nothing yet: upload this device's non-default synced settings once. */
  | { readonly kind: "seed"; readonly patch: SyncedClientSettingsPatch }
  /** Replace the local settings with the server's, keeping unacknowledged local writes. */
  | { readonly kind: "apply"; readonly settings: ClientSettings };

/**
 * Decides what to do with the server's latest snapshot. `pending` holds local writes the server
 * has not acknowledged yet, so an echo of an older value cannot undo an edit the user just made.
 */
export function reconcileClientSettings(input: {
  readonly local: ClientSettings;
  readonly server: ClientSettingsSyncSnapshot;
  readonly pending: SyncedClientSettingsPatch;
}): ClientSettingsSyncStep {
  if (!input.server.seeded) {
    // A device with only defaults has nothing worth uploading; leaving the server unseeded
    // lets a later device that does hold custom settings migrate them.
    const patch = diffSyncedClientSettings(DEFAULT_CLIENT_SETTINGS, input.local);
    return Object.keys(patch).length === 0 ? { kind: "none" } : { kind: "seed", patch };
  }
  const settings: ClientSettings = { ...input.local, ...input.server.settings, ...input.pending };
  return stableStringify(settings) === stableStringify(input.local)
    ? { kind: "none" }
    : { kind: "apply", settings };
}

/** Tracks local writes that are in flight so snapshots arriving meanwhile cannot revert them. */
export class PendingClientSettingsWrites {
  private readonly entries = new Map<string, { value: unknown; inFlight: number }>();

  begin(patch: SyncedClientSettingsPatch): void {
    for (const [key, value] of Object.entries(patch)) {
      const entry = this.entries.get(key);
      this.entries.set(key, { value, inFlight: (entry?.inFlight ?? 0) + 1 });
    }
  }

  /** Releases a write once the server answered; the key's latest local value stays until all settle. */
  settle(patch: SyncedClientSettingsPatch): void {
    for (const key of Object.keys(patch)) {
      const entry = this.entries.get(key);
      if (entry === undefined) continue;
      if (entry.inFlight <= 1) this.entries.delete(key);
      else entry.inFlight -= 1;
    }
  }

  snapshot(): SyncedClientSettingsPatch {
    return Object.fromEntries(
      [...this.entries].map(([key, { value }]) => [key, value]),
    ) as SyncedClientSettingsPatch;
  }

  clear(): void {
    this.entries.clear();
  }
}
