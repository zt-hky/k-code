import {
  DesktopCloudflareAccessRecoverySchema,
  DesktopCloudflareAccessSessionSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopCloudflareAccess from "../../cloudflareAccess/DesktopCloudflareAccess.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const recoverCloudflareAccess = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.RECOVER_CLOUDFLARE_ACCESS_CHANNEL,
  payload: Schema.String,
  result: DesktopCloudflareAccessRecoverySchema,
  handler: Effect.fn("desktop.ipc.cloudflareAccess.recover")(function* (origin) {
    const access = yield* DesktopCloudflareAccess.DesktopCloudflareAccess;
    return yield* access.recover(origin);
  }),
});

export const getCloudflareAccessSessions = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_CLOUDFLARE_ACCESS_SESSIONS_CHANNEL,
  payload: Schema.Void,
  result: Schema.Array(DesktopCloudflareAccessSessionSchema),
  handler: Effect.fn("desktop.ipc.cloudflareAccess.sessions")(function* () {
    const access = yield* DesktopCloudflareAccess.DesktopCloudflareAccess;
    return yield* access.sessions;
  }),
});

export const clearCloudflareAccess = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CLEAR_CLOUDFLARE_ACCESS_CHANNEL,
  payload: Schema.String,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.cloudflareAccess.clear")(function* (origin) {
    const access = yield* DesktopCloudflareAccess.DesktopCloudflareAccess;
    yield* access.clear(origin);
  }),
});
