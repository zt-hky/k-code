import { useAtomValue } from "@effect/atom-react";
import type {
  AcpRegistryImportSessionInput,
  AcpRegistryListProjectsInput,
  AcpRegistryListSessionsInput,
  EnvironmentId,
  ScopedProjectRef,
  ServerProvider,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";

import { openResumeSessionDialog } from "../components/resumeSessionDialogState";
import { toastManager } from "../components/ui/toast";
import { deriveProviderInstanceEntries, type ProviderInstanceEntry } from "../providerInstances";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { providersIgnoringCheckedAtAtom, serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";

function providerSupportsSessionResume(provider: ServerProvider): boolean {
  const sessions = provider.nativeSessions;
  return (
    provider.enabled &&
    sessions?.canList === true &&
    (sessions.canLoad === true || sessions.canResume === true)
  );
}

/** Read once when a menu opens, so menus do not re-render on every provider push. */
export function readEnvironmentSupportsSessionResume(environmentId: EnvironmentId): boolean {
  return appAtomRegistry
    .get(providersIgnoringCheckedAtAtom(environmentId))
    .some(providerSupportsSessionResume);
}

export function useResumableSessionInstances(
  environmentId: EnvironmentId,
): ReadonlyArray<ProviderInstanceEntry> {
  const providers = useAtomValue(providersIgnoringCheckedAtAtom(environmentId));
  return deriveProviderInstanceEntries(providers).filter((entry) =>
    providerSupportsSessionResume(entry.snapshot),
  );
}

export function acpFailureMessage(result: AtomCommandResult<unknown, unknown>): string | null {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "The ACP operation failed.";
}

export function reportAcpFailure(title: string, result: AtomCommandResult<unknown, unknown>) {
  const description = acpFailureMessage(result);
  if (description === null) return;
  toastManager.add({ type: "error", title, description });
}

export function useAcpNativeSessionCommands(environmentId: EnvironmentId) {
  const list = useAtomCommand(serverEnvironment.listAcpRegistrySessions, {
    reportFailure: false,
  });
  const importSession = useAtomCommand(serverEnvironment.importAcpRegistrySession, {
    reportFailure: false,
  });
  const projects = useAtomCommand(serverEnvironment.listAcpRegistryProjects, {
    reportFailure: false,
  });
  return {
    listSessions: (input: AcpRegistryListSessionsInput) => list({ environmentId, input }),
    importSession: (input: AcpRegistryImportSessionInput) =>
      importSession({ environmentId, input }),
    listProjects: (input: AcpRegistryListProjectsInput) => projects({ environmentId, input }),
  };
}

/** Tells a user who just added a folder that the agent already has sessions there, without blocking them. */
export function useOfferSessionResume() {
  const list = useAtomCommand(serverEnvironment.listAcpRegistrySessions, {
    reportFailure: false,
  });
  return async (projectRef: ScopedProjectRef, projectTitle: string) => {
    const instances = appAtomRegistry
      .get(providersIgnoringCheckedAtAtom(projectRef.environmentId))
      .filter(providerSupportsSessionResume);
    const results = await Promise.all(
      instances.map((provider) =>
        list({
          environmentId: projectRef.environmentId,
          input: { instanceId: provider.instanceId, projectId: projectRef.projectId },
        }),
      ),
    );
    let count = 0;
    let hasMore = false;
    for (const result of results) {
      if (result._tag !== "Success") continue;
      count += result.value.sessions.length;
      if (result.value.nextCursor !== null) hasMore = true;
    }
    if (count === 0) return;
    const toastId = toastManager.add({
      type: "info",
      title: `${count}${hasMore ? "+" : ""} earlier ${count === 1 && !hasMore ? "session" : "sessions"} in ${projectTitle}`,
      description: "Pick one up where the agent left off.",
      actionProps: {
        children: "Resume session…",
        onClick: () => {
          toastManager.close(toastId);
          openResumeSessionDialog(projectRef);
        },
      },
    });
  };
}
