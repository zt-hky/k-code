import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import type { AtomRegistry } from "effect/reactivity";

import { isElectron } from "./env";
import { getClientSettings } from "./hooks/useSettings";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "./state/primaryEnvironment";
import { environmentShell } from "./state/shell";
import { webPushGetPublicKey, webPushSubscribe, webPushUnsubscribe } from "./state/webPush";
import { hasDesktopNotifications } from "./threadNotifications";

const SERVICE_WORKER_URL = "/sw.js";
const OPEN_THREAD_MESSAGE = "t3code:open-thread";

export type WebPushSupport = "supported" | "ios-browser-tab" | "unsupported";

/** iOS only delivers Web Push to web apps opened from the Home Screen. */
export function webPushSupport(): WebPushSupport {
  if (isElectron || typeof window === "undefined" || !window.isSecureContext) return "unsupported";
  const isIos =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && navigator.standalone === true);
  if (isIos && !standalone) return "ios-browser-tab";
  return "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
    ? "supported"
    : "unsupported";
}

let active = false;

/** True while the primary environment pushes this device's notifications. */
export function isWebPushActive(): boolean {
  return active;
}

// Uint8Array.fromBase64 is missing before iOS 18.2.
function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function commandError(result: AtomCommandResult<unknown, unknown>): string | null {
  if (result._tag === "Success") return null;
  if (isAtomCommandInterrupted(result)) return "The request was interrupted.";
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "The server rejected the request.";
}

function sameKey(current: ArrayBuffer | null, expected: Uint8Array): boolean {
  if (current === null || current.byteLength !== expected.byteLength) return false;
  const bytes = new Uint8Array(current);
  return bytes.every((byte, index) => byte === expected[index]);
}

async function registerSubscription(
  environmentId: EnvironmentId,
  subscription: PushSubscription,
): Promise<string | null> {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return "The browser returned an incomplete subscription.";
  const result = await runAtomCommand(
    appAtomRegistry,
    webPushSubscribe,
    { environmentId, input: { endpoint: json.endpoint, keys: { p256dh, auth } } },
    { reportFailure: false },
  );
  return commandError(result);
}

/** Subscribes this device to the environment's pushes. Returns an error message on failure. */
export async function enableWebPush(environmentId: EnvironmentId): Promise<string | null> {
  try {
    const keyResult = await runAtomCommand(
      appAtomRegistry,
      webPushGetPublicKey,
      { environmentId, input: {} },
      { reportFailure: false },
    );
    if (keyResult._tag === "Failure") return commandError(keyResult);
    const applicationServerKey = decodeBase64Url(keyResult.value.publicKey);
    await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    // A subscription is bound to one VAPID key; a different server key needs a new one.
    if (
      subscription !== null &&
      !sameKey(subscription.options.applicationServerKey, applicationServerKey)
    ) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
    const error = await registerSubscription(environmentId, subscription);
    active = error === null;
    return error;
  } catch (error) {
    active = false;
    return error instanceof Error ? error.message : String(error);
  }
}

export async function disableWebPush(environmentId: EnvironmentId | null): Promise<void> {
  active = false;
  try {
    const registration = await navigator.serviceWorker?.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    if (environmentId !== null) {
      await runAtomCommand(
        appAtomRegistry,
        webPushUnsubscribe,
        { environmentId, input: { endpoint: subscription.endpoint } },
        { reportFailure: false },
      );
    }
    await subscription.unsubscribe();
  } catch {
    // Disabling is best effort; the server prunes endpoints the push service reports gone.
  }
}

/** Re-sends an existing subscription so the server ties it to this session. Never prompts. */
async function refreshWebPush(environmentId: EnvironmentId): Promise<void> {
  if (
    !hasDesktopNotifications(getClientSettings().notificationMode) ||
    Notification.permission !== "granted"
  ) {
    return;
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    active = (await registerSubscription(environmentId, subscription)) === null;
  } catch {
    active = false;
  }
}

export function startWebPush(registry: AtomRegistry.AtomRegistry, router: AnyRouter): () => void {
  if (webPushSupport() !== "supported") return () => {};

  const onMessage = (event: MessageEvent) => {
    const data: unknown = event.data;
    if (
      typeof data !== "object" ||
      data === null ||
      !("type" in data) ||
      data.type !== OPEN_THREAD_MESSAGE ||
      !("environmentId" in data) ||
      typeof data.environmentId !== "string" ||
      !("threadId" in data) ||
      typeof data.threadId !== "string"
    ) {
      return;
    }
    void router.navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: data.environmentId, threadId: data.threadId },
    });
  };
  navigator.serviceWorker.addEventListener("message", onMessage);
  navigator.serviceWorker.startMessages();

  let refreshedEnvironmentId: EnvironmentId | null = null;
  let unsubscribeShell = () => {};
  const unsubscribePrimary = registry.subscribe(
    primaryEnvironmentIdAtom,
    (environmentId) => {
      unsubscribeShell();
      unsubscribeShell = () => {};
      if (environmentId === null) {
        active = false;
        return;
      }
      unsubscribeShell = registry.subscribe(
        environmentShell.stateValueAtom(environmentId),
        (shell) => {
          if (shell.status !== "live" || refreshedEnvironmentId === environmentId) return;
          refreshedEnvironmentId = environmentId;
          void refreshWebPush(environmentId);
        },
        { immediate: true },
      );
    },
    { immediate: true },
  );

  return () => {
    navigator.serviceWorker.removeEventListener("message", onMessage);
    unsubscribePrimary();
    unsubscribeShell();
  };
}
