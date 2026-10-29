import {
  LocalhostAuthCallbackResultSchema,
  LocalOmpCredentialsResultSchema,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  cancelLocalhostAuthCallback as cancelBridge,
  receiveLocalhostAuthCallback as receiveBridge,
} from "../../app/LocalhostAuthBridge.ts";
import { readLocalOmpCredentials as readCredentials } from "../../app/LocalOmpCredentials.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as IpcChannels from "../channels.ts";

const AuthorizationUrl = Schema.String.check(Schema.isMaxLength(16_384));

/**
 * Catches a model provider's localhost sign-in redirect for whichever environment is running the
 * sign-in. The renderer hands the returned callback URL to that environment's respond RPC.
 */
export const receiveLocalhostAuthCallback = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.RECEIVE_LOCALHOST_AUTH_CALLBACK_CHANNEL,
  payload: AuthorizationUrl,
  result: LocalhostAuthCallbackResultSchema,
  handler: Effect.fn("desktop.ipc.localhostAuth.receive")(function* (authorizationUrl) {
    const windows = yield* ElectronWindow.ElectronWindow;
    const outcome = yield* Effect.promise(() => receiveBridge(authorizationUrl));
    if (outcome.status === "received") {
      const window = yield* windows.currentMainOrFirst;
      if (Option.isSome(window)) yield* windows.reveal(window.value);
    }
    return outcome;
  }),
});

export const cancelLocalhostAuthCallback = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CANCEL_LOCALHOST_AUTH_CALLBACK_CHANNEL,
  payload: AuthorizationUrl,
  result: Schema.Void,
  handler: (authorizationUrl) => Effect.sync(() => cancelBridge(authorizationUrl)),
});

export const readLocalOmpCredentials = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.READ_LOCAL_OMP_CREDENTIALS_CHANNEL,
  payload: Schema.Void,
  result: LocalOmpCredentialsResultSchema,
  handler: Effect.fn("desktop.ipc.localOmpCredentials.read")(function* () {
    const platform = yield* HostProcess.Platform;
    return yield* Effect.promise(() => readCredentials(platform));
  }),
});
