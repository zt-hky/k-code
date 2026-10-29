import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import {
  hasDesktopNotifications,
  hasNotificationSound,
  NOTIFICATION_MODE_LABELS,
  unlockNotificationAudio,
} from "../../threadNotifications";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { disableWebPush, enableWebPush, webPushSupport } from "../../webPush";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function NotificationSettings() {
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  return (
    <SettingsRow
      {...searchableSetting("thread-notifications")}
      description={
        permissionMessage ??
        "System alerts when a thread finishes, fails, or needs input or approval. Applies to this device while T3 Code is open."
      }
      control={
        <Select
          value={mode}
          disabled={requesting}
          onValueChange={async (value) => {
            if (
              value !== "off" &&
              value !== "notifications" &&
              value !== "sound" &&
              value !== "notifications-and-sound"
            )
              return;
            setPermissionMessage(null);
            if (hasNotificationSound(value)) unlockNotificationAudio();
            if (hasDesktopNotifications(value)) {
              if (webPushSupport() === "ios-browser-tab") {
                setPermissionMessage(
                  "On iPhone and iPad, add T3 Code to your Home Screen (Share → Add to Home Screen), open it from there, then turn notifications on.",
                );
                return;
              }
              if (typeof Notification === "undefined" || !window.isSecureContext) {
                setPermissionMessage(
                  "Notifications need a supported browser over HTTPS, or the desktop app. Sound only is still available.",
                );
                return;
              }
              setRequesting(true);
              const permission = await settlePromise(() => Notification.requestPermission());
              setRequesting(false);
              if (permission._tag === "Failure") {
                setPermissionMessage(
                  "Notifications are unavailable in this browser. Sound only is still available.",
                );
                return;
              }
              if (permission.value !== "granted") {
                setPermissionMessage(
                  "Allow notifications in your browser or system settings, then choose this option again. Sound only is still available.",
                );
                return;
              }
              const primaryEnvironmentId = appAtomRegistry.get(primaryEnvironmentIdAtom);
              if (primaryEnvironmentId !== null && webPushSupport() === "supported") {
                setRequesting(true);
                const pushError = await enableWebPush(primaryEnvironmentId);
                setRequesting(false);
                if (pushError !== null) {
                  setPermissionMessage(
                    `Notifications work while T3 Code is open. Background notifications could not be enabled: ${pushError}`,
                  );
                }
              }
            } else {
              void disableWebPush(appAtomRegistry.get(primaryEnvironmentIdAtom));
            }
            updateSettings({ notificationMode: value });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Thread notifications">
            <SelectValue>{NOTIFICATION_MODE_LABELS[mode]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {Object.entries(NOTIFICATION_MODE_LABELS).map(([value, label]) => (
              <SelectItem key={value} hideIndicator value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
