import type { DesktopBridge, DesktopCloudflareAccessSession } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { formatAccessTimestamp } from "./ConnectionsSettings.logic";
import { SettingsRow } from "./settingsLayout";

/** Desktop sign-ins to Cloudflare Access in front of remote environments, with sign-out. */
export function CloudflareAccessSessions({ desktopBridge }: { desktopBridge: DesktopBridge }) {
  const [sessions, setSessions] = useState<readonly DesktopCloudflareAccessSession[]>([]);
  const [signingOut, setSigningOut] = useState<string | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- sign-ins live in the desktop main process
  useEffect(() => {
    let cancelled = false;
    void desktopBridge.getCloudflareAccessSessions().then((next) => {
      if (!cancelled) setSessions(next);
    });
    return () => {
      cancelled = true;
    };
  }, [desktopBridge]);

  const signOut = (origin: string) => {
    setSigningOut(origin);
    void desktopBridge
      .clearCloudflareAccess(origin)
      .then(() => desktopBridge.getCloudflareAccessSessions())
      .then(setSessions, (error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Could not sign out of Cloudflare Access",
          description: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => setSigningOut(null));
  };

  return sessions.map((session) => (
    <SettingsRow
      key={session.origin}
      title={`Cloudflare Access: ${new URL(session.origin).host}`}
      description={
        session.expiresAt
          ? `Signed in until ${formatAccessTimestamp(session.expiresAt)}. K-code asks again after that.`
          : "Signed in."
      }
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={signingOut === session.origin}
          onClick={() => signOut(session.origin)}
        >
          Sign out
        </Button>
      }
    />
  ));
}
