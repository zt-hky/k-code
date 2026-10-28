import { useAtomValue } from "@effect/atom-react";
import {
  findProjectByPath,
  inferProjectTitleFromPath,
} from "@t3tools/client-runtime/state/projects";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type AcpRegistryNativeProject,
  type AcpRegistrySession,
  type EnvironmentId,
  type ProjectId,
  ProviderInstanceId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { FolderPlusIcon, HistoryIcon } from "lucide-react";
import { useEffect, useState } from "react";

import {
  acpFailureMessage,
  reportAcpFailure,
  useAcpNativeSessionCommands,
  useResumableSessionInstances,
} from "../hooks/useAcpNativeSessions";
import { useStableCallback } from "../hooks/useStableCallback";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { primaryServerKeybindingsAtom, serverEnvironment } from "../state/server";
import { useProject, useProjects, waitForProject } from "../state/entities";
import { projectEnvironment } from "../state/projects";
import { useAtomCommand } from "../state/use-atom-command";
import { newProjectId } from "../lib/utils";
import { useEnvironmentScope } from "~/state/session";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { buildThreadRouteParams } from "../threadRoutes";
import {
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
} from "./CommandPalette.logic";
import { CommandPaletteContent } from "./CommandPaletteContent";
import { CommandPaletteResults } from "./CommandPaletteResults";
import {
  openResumeSessionDialog,
  resumeSessionDialogProjectAtom,
} from "./resumeSessionDialogState";
import { Badge } from "./ui/badge";
import { CommandDialog, CommandDialogPopup, CommandFooterAction } from "./ui/command";

type InstanceSessions =
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "ready";
      readonly sessions: ReadonlyArray<AcpRegistrySession>;
      readonly nextCursor: string | null;
    };

type InstanceProjects =
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly projects: ReadonlyArray<AcpRegistryNativeProject> };

const SHORT_SESSION_ID_LENGTH = 8;
const MAX_NATIVE_PROJECTS = 20;

function sessionDescription(session: AcpRegistrySession): string {
  const shortId = session.sessionId.slice(0, SHORT_SESSION_ID_LENGTH);
  const count = session.messageCount;
  return count === undefined
    ? shortId
    : `${shortId} · ${count} ${count === 1 ? "message" : "messages"}`;
}

function sessionUpdatedAtMs(session: AcpRegistrySession): number {
  const parsed = session.updatedAt === null ? Number.NaN : Date.parse(session.updatedAt);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function ResumeSessionContent(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projectName: string;
  readonly onOpenThread: (threadRef: ScopedThreadRef) => void;
}) {
  const { environmentId, projectId } = props;
  const instances = useResumableSessionInstances(environmentId);
  const canImport = useAtomValue(
    serverEnvironment.importAcpRegistrySession.permissionAtom(environmentId),
  );
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { listSessions, importSession, listProjects } = useAcpNativeSessionCommands(environmentId);
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const canCreateProject = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const [query, setQuery] = useState("");
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const [byInstance, setByInstance] = useState<Readonly<Record<string, InstanceSessions>>>({});
  const [projectsByInstance, setProjectsByInstance] = useState<
    Readonly<Record<string, InstanceProjects>>
  >({});
  const [loadingMore, setLoadingMore] = useState(false);
  const [resuming, setResuming] = useState(false);
  const instanceKey = instances.map((entry) => entry.instanceId).join("\n");
  const environmentProjects = useProjects().filter(
    (project) => project.environmentId === environmentId,
  );

  const loadPage = async (instanceId: ProviderInstanceId, cursor?: string) => {
    const result = await listSessions({
      instanceId,
      projectId,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (result._tag === "Success") {
      setByInstance((current) => {
        const previous = current[instanceId];
        const earlier =
          cursor !== undefined && previous?.status === "ready" ? previous.sessions : [];
        return {
          ...current,
          [instanceId]: {
            status: "ready",
            sessions: [...earlier, ...result.value.sessions],
            nextCursor: result.value.nextCursor,
          },
        };
      });
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    if (cursor !== undefined) {
      reportAcpFailure("Could not load more sessions", result);
      return;
    }
    setByInstance((current) => ({
      ...current,
      [instanceId]: {
        status: "error",
        message: acpFailureMessage(result) ?? "Could not list sessions.",
      },
    }));
  };
  const loadProjects = async (instanceId: ProviderInstanceId) => {
    const result = await listProjects({ instanceId });
    if (result._tag === "Success") {
      setProjectsByInstance((current) => ({
        ...current,
        [instanceId]: { status: "ready", projects: result.value.projects },
      }));
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    setProjectsByInstance((current) => ({
      ...current,
      [instanceId]: {
        status: "error",
        message: acpFailureMessage(result) ?? "Could not list projects.",
      },
    }));
  };
  const loadFirstPages = useStableCallback((keyedInstanceIds: string) => {
    for (const id of keyedInstanceIds.split("\n")) {
      if (id.length === 0) continue;
      const instanceId = ProviderInstanceId.make(id);
      void loadPage(instanceId);
      const entry = instances.find((candidate) => candidate.instanceId === instanceId);
      if (entry?.snapshot.nativeSessions?.canListProjects === true) void loadProjects(instanceId);
    }
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Fetch each agent's native sessions and projects from the server when the dialog opens or the supporting instances change.
  useEffect(() => {
    loadFirstPages(instanceKey);
  }, [instanceKey, loadFirstPages]);

  const loadMore = async () => {
    setLoadingMore(true);
    await Promise.all(
      instances.flatMap((entry) => {
        const state = byInstance[entry.instanceId];
        return state?.status === "ready" && state.nextCursor !== null
          ? [loadPage(entry.instanceId, state.nextCursor)]
          : [];
      }),
    );
    setLoadingMore(false);
  };

  const resume = async (instanceId: ProviderInstanceId, session: AcpRegistrySession) => {
    if (resuming) return;
    if (session.importedThreadId !== null) {
      props.onOpenThread(scopeThreadRef(environmentId, session.importedThreadId));
      return;
    }
    setResuming(true);
    const result = await importSession({
      instanceId,
      projectId,
      sessionId: session.sessionId,
      title: session.title,
      updatedAt: session.updatedAt,
    });
    setResuming(false);
    if (result._tag === "Success") {
      props.onOpenThread(scopeThreadRef(environmentId, result.value.threadId));
      return;
    }
    reportAcpFailure("Could not resume session", result);
  };

  const addProject = async (cwd: string, title: string) => {
    if (resuming) return;
    const newId = newProjectId();
    const created = await createProject({
      environmentId,
      input: {
        projectId: newId,
        title,
        workspaceRoot: cwd,
        createWorkspaceRootIfMissing: false,
        defaultModelSelection: null,
      },
    });
    if (created._tag === "Failure") {
      reportAcpFailure("Could not add project", created);
      return;
    }
    const projectRef = scopeProjectRef(environmentId, newId);
    await waitForProject(projectRef);
    openResumeSessionDialog(projectRef);
  };

  const normalizedQuery = query.trim().toLowerCase();
  const groups: CommandPaletteGroup[] = [];
  for (const entry of instances) {
    const state = byInstance[entry.instanceId];
    const label = instances.length > 1 ? entry.displayName : props.projectName;
    const statusRow = (title: string, description?: string): CommandPaletteActionItem => ({
      kind: "action",
      value: `resume-session:${entry.instanceId}:status`,
      searchTerms: [],
      title,
      ...(description === undefined ? {} : { description }),
      disabled: true,
      icon: <HistoryIcon className={ITEM_ICON_CLASS} />,
      run: async () => {},
    });
    if (state === undefined) {
      groups.push({
        value: entry.instanceId,
        label,
        items: [statusRow("Loading sessions…")],
      });
      continue;
    }
    if (state.status === "error") {
      groups.push({
        value: entry.instanceId,
        label,
        items: [statusRow("Could not load sessions", state.message)],
      });
      continue;
    }
    const items = state.sessions
      .filter(
        (session) =>
          normalizedQuery.length === 0 ||
          (session.title ?? "").toLowerCase().includes(normalizedQuery) ||
          session.sessionId.toLowerCase().includes(normalizedQuery),
      )
      .toSorted((left, right) => sessionUpdatedAtMs(right) - sessionUpdatedAtMs(left))
      .map((session): CommandPaletteActionItem => ({
        kind: "action",
        value: `resume-session:${entry.instanceId}:${session.sessionId}`,
        searchTerms: [session.title ?? "", session.sessionId],
        title: session.title ?? "Untitled session",
        description: sessionDescription(session),
        disabled: session.importedThreadId === null && !canImport,
        icon: <HistoryIcon className={ITEM_ICON_CLASS} />,
        ...(session.importedThreadId === null
          ? {}
          : {
              titleTrailingContent: (
                <Badge size="sm" variant="secondary">
                  Open
                </Badge>
              ),
            }),
        ...(session.updatedAt === null
          ? {}
          : { timestamp: formatRelativeTimeLabel(session.updatedAt) }),
        run: () => resume(entry.instanceId, session),
      }));
    if (items.length > 0) groups.push({ value: entry.instanceId, label, items });
  }
  for (const entry of instances) {
    const state = projectsByInstance[entry.instanceId];
    if (state === undefined) continue;
    const label = `Projects in ${entry.displayName}`;
    if (state.status === "error") {
      groups.push({
        value: `${entry.instanceId}:projects`,
        label,
        items: [
          {
            kind: "action",
            value: `omp-project:${entry.instanceId}:status`,
            searchTerms: [],
            title: `Could not load ${entry.displayName} projects`,
            description: state.message,
            disabled: true,
            icon: <FolderPlusIcon className={ITEM_ICON_CLASS} />,
            run: async () => {},
          },
        ],
      });
      continue;
    }
    const projectItems = state.projects
      .filter(
        (project) =>
          findProjectByPath(environmentProjects, project.cwd) === undefined &&
          (normalizedQuery.length === 0 || project.cwd.toLowerCase().includes(normalizedQuery)),
      )
      .slice(0, MAX_NATIVE_PROJECTS)
      .map((project): CommandPaletteActionItem => {
        const title = inferProjectTitleFromPath(project.cwd);
        return {
          kind: "action",
          value: `omp-project:${entry.instanceId}:${project.cwd}`,
          searchTerms: [project.cwd, title],
          title,
          description: project.cwd,
          disabled: !canCreateProject,
          icon: <FolderPlusIcon className={ITEM_ICON_CLASS} />,
          titleTrailingContent: (
            <Badge size="sm" variant="secondary">
              {project.sessionCount} {project.sessionCount === 1 ? "session" : "sessions"}
            </Badge>
          ),
          ...(project.lastActivityAt === null
            ? {}
            : { timestamp: formatRelativeTimeLabel(project.lastActivityAt) }),
          run: () => addProject(project.cwd, title),
        };
      });
    if (projectItems.length > 0) {
      groups.push({ value: `${entry.instanceId}:projects`, label, items: projectItems });
    }
  }
  const hasMore = Object.values(byInstance).some(
    (state) => state.status === "ready" && state.nextCursor !== null,
  );

  return (
    <CommandPaletteContent
      aria-label="Resume session"
      autoHighlight="always"
      escapeLabel="Close"
      footerActionLabel="Resume"
      footerTrailing={
        hasMore ? (
          <CommandFooterAction disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? "Loading…" : "Load more"}
          </CommandFooterAction>
        ) : null
      }
      inputProps={{ placeholder: "Search sessions…" }}
      mode="none"
      onItemHighlighted={(value) => {
        setHighlightedItemValue(typeof value === "string" ? value : null);
      }}
      onValueChange={(value) => {
        setHighlightedItemValue(null);
        setQuery(value);
      }}
      panelSize="tall-list"
      testId="resume-session-dialog"
      value={query}
    >
      <CommandPaletteResults
        emptyStateMessage={
          normalizedQuery.length > 0
            ? "No matching sessions."
            : "No sessions found for this project."
        }
        groups={groups}
        highlightedItemValue={highlightedItemValue}
        isActionsOnly={false}
        keybindings={keybindings}
        onExecuteItem={(item) => {
          if (item.kind === "action") void item.run();
        }}
      />
    </CommandPaletteContent>
  );
}

export function ResumeSessionDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projectName: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenThread: (threadRef: ScopedThreadRef) => void;
}) {
  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? (
        <CommandDialogPopup
          aria-label="Resume session"
          className="overflow-hidden"
          onBackdropPointerDown={() => props.onOpenChange(false)}
        >
          <ResumeSessionContent
            key={`${props.environmentId}:${props.projectId}`}
            environmentId={props.environmentId}
            projectId={props.projectId}
            projectName={props.projectName}
            onOpenThread={props.onOpenThread}
          />
        </CommandDialogPopup>
      ) : null}
    </CommandDialog>
  );
}

export function ResumeSessionDialogHost() {
  const projectRef = useAtomValue(resumeSessionDialogProjectAtom);
  const project = useProject(projectRef);
  const router = useRouter();
  if (projectRef === null) return null;
  const close = () => appAtomRegistry.set(resumeSessionDialogProjectAtom, null);
  return (
    <ResumeSessionDialog
      key={`${projectRef.environmentId}:${projectRef.projectId}`}
      environmentId={projectRef.environmentId}
      projectId={projectRef.projectId}
      projectName={project?.title ?? "Sessions"}
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      onOpenThread={(threadRef) => {
        close();
        void router.navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(threadRef),
        });
      }}
    />
  );
}
