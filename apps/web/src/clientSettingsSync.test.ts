import {
  DEFAULT_CLIENT_SETTINGS,
  type ClientSettingsPatch,
  type ClientSettingsSyncSnapshot,
  SyncedClientSettingsSchema,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  PendingClientSettingsWrites,
  diffSyncedClientSettings,
  pickSyncedClientPatch,
  reconcileClientSettings,
} from "./clientSettingsSync";

const local = { ...DEFAULT_CLIENT_SETTINGS, chatWidth: "comfortable" as const, fontSizeCode: 15 };
const decodeSyncedSettings = Schema.decodeSync(SyncedClientSettingsSchema);
// Like the server's: only synced keys, with defaults filled in.
const serverSnapshot = (
  overrides: Partial<ClientSettingsSyncSnapshot["settings"]>,
  seeded = true,
): ClientSettingsSyncSnapshot => ({
  settings: decodeSyncedSettings(overrides),
  seeded,
});

describe("pickSyncedClientPatch", () => {
  it("drops device-local keys and undefined values", () => {
    expect(
      pickSyncedClientPatch({
        chatWidth: "full",
        fontSizeCode: 15,
        snapShotEnabled: true,
        wordWrap: undefined,
      } as unknown as ClientSettingsPatch),
    ).toEqual({ chatWidth: "full" });
  });
});

describe("diffSyncedClientSettings", () => {
  it("lists changed synced keys only", () => {
    expect(
      diffSyncedClientSettings(DEFAULT_CLIENT_SETTINGS, {
        ...DEFAULT_CLIENT_SETTINGS,
        chatWidth: "comfortable",
        fontSizeCode: 15,
        threadDetailsItems: { usage: true },
      }),
    ).toEqual({ chatWidth: "comfortable" });
  });
});

describe("reconcileClientSettings", () => {
  it("seeds an unseeded server with this device's non-default synced settings once", () => {
    expect(
      reconcileClientSettings({ local, server: serverSnapshot({}, false), pending: {} }),
    ).toEqual({ kind: "seed", patch: { chatWidth: "comfortable" } });
  });

  it("leaves an unseeded server alone when this device holds only defaults", () => {
    expect(
      reconcileClientSettings({
        local: DEFAULT_CLIENT_SETTINGS,
        server: serverSnapshot({}, false),
        pending: {},
      }),
    ).toEqual({ kind: "none" });
  });

  it("prefers the server over local values once seeded, and keeps device-local keys", () => {
    const step = reconcileClientSettings({
      local,
      server: serverSnapshot({ chatWidth: "full", wordWrap: false }),
      pending: {},
    });
    expect(step).toEqual({
      kind: "apply",
      settings: { ...local, chatWidth: "full", wordWrap: false },
    });
  });

  it("keeps unacknowledged local writes on top of an older snapshot", () => {
    const step = reconcileClientSettings({
      local: { ...local, wordWrap: false },
      server: serverSnapshot({ chatWidth: "comfortable", wordWrap: true }),
      pending: { wordWrap: false },
    });
    expect(step).toEqual({ kind: "none" });
  });

  it("does nothing when local already matches the server", () => {
    expect(
      reconcileClientSettings({
        local,
        server: serverSnapshot({ chatWidth: "comfortable" }),
        pending: {},
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("PendingClientSettingsWrites", () => {
  it("holds the latest value until every write to a key has settled", () => {
    const pending = new PendingClientSettingsWrites();
    pending.begin({ wordWrap: false });
    pending.begin({ wordWrap: true });

    pending.settle({ wordWrap: false });
    expect(pending.snapshot()).toEqual({ wordWrap: true });

    pending.settle({ wordWrap: true });
    expect(pending.snapshot()).toEqual({});
  });
});
