import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

const WebPushKey = TrimmedNonEmptyString.check(Schema.isMaxLength(256));

/** The server's VAPID public key: base64url, uncompressed P-256 point. */
export const WebPushPublicKeyResult = Schema.Struct({ publicKey: TrimmedNonEmptyString });
export type WebPushPublicKeyResult = typeof WebPushPublicKeyResult.Type;

const WebPushEndpoint = TrimmedNonEmptyString.check(
  Schema.isMaxLength(2048),
  Schema.isPattern(/^https:\/\/./i),
);

export const WebPushSubscribeInput = Schema.Struct({
  endpoint: WebPushEndpoint,
  keys: Schema.Struct({ p256dh: WebPushKey, auth: WebPushKey }),
});
export type WebPushSubscribeInput = typeof WebPushSubscribeInput.Type;

export const WebPushUnsubscribeInput = Schema.Struct({ endpoint: WebPushEndpoint });
export type WebPushUnsubscribeInput = typeof WebPushUnsubscribeInput.Type;

export class WebPushError extends Schema.TaggedError<WebPushError>()("WebPushError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}
