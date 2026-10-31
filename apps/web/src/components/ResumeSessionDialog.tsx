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

type SessionScope = "project" | "all";

const sessionsKey = (scope: SessionScope, instanceId: string) =>
  scope === "all" ? `all:${instanceId}` : instanceId;

function sessionTitle(session: AcpRegistrySession): string {
  if (session.title !== null) return session.title;
  const updatedAtMs = Date.parse(session.updatedAt ?? "");
  return Number.isNaN(updatedAtMs)
    ? "Untitled session"
    : `Untitled · ${new Date(updatedAtMs).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
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
  const { listSessions, listAllSessions, importSession, listProjects } =
    useAcpNativeSessionCommands(environmentId);
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
  const [scope, setScope] = useState<SessionScope>("project");
  const instanceKey = instances.map((entry) => entry.instanceId).join("\n");
  const environmentProjects = useProjects().filter(
    (project) => project.environmentId === environmentId,
  );

  const loadPage = async (
    instanceId: ProviderInstanceId,
    cursor?: string,
    pageScope: SessionScope = "project",
  ) => {
    const cursorInput = cursor === undefined ? {} : { cursor };
    const result =
      pageScope === "all"
        ? await listAllSessions({ instanceId, ...cursorInput })
        : await listSessions({ instanceId, projectId, ...cursorInput });
    const key = sessionsKey(pageScope, instanceId);
    if (result._tag === "Success") {
      setByInstance((current) => {
        const previous = current[key];
        const earlier =
          cursor !== undefined && previous?.status === "ready" ? previous.sessions : [];
        return {
          ...current,
          [key]: {
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
      [key]: {
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

  const scopedInstances =
    scope === "all"
      ? instances.filter((entry) => entry.snapshot.nativeSessions?.canListAllSessions === true)
      : instances;
  const canListAll = instances.some(
    (entry) => entry.snapshot.nativeSessions?.canListAllSessions === true,
  );

  const toggleScope = () => {
    const next: SessionScope = scope === "all" ? "project" : "all";
    setScope(next);
    setHighlightedItemValue(null);
    if (next === "project") return;
    for (const entry of instances) {
      if (entry.snapshot.nativeSessions?.canListAllSessions !== true) continue;
      if (byInstance[sessionsKey("all", entry.instanceId)] === undefined) {
        void loadPage(entry.instanceId, undefined, "all");
      }
    }
  };

  const loadMore = async () => {
    setLoadingMore(true);
    await Promise.all(
      scopedInstances.flatMap((entry) => {
        const state = byInstance[sessionsKey(scope, entry.instanceId)];
        return state?.status === "ready" && state.nextCursor !== null
          ? [loadPage(entry.instanceId, state.nextCursor, scope)]
          : [];
      }),
    );
    setLoadingMore(false);
  };

  const createNativeProject = async (cwd: string, title: string): Promise<ProjectId | null> => {
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
      return null;
    }
    await waitForProject(scopeProjectRef(environmentId, newId));
    return newId;
  };

  // A session from another folder resumes into that folder's project, created on first use.
  const projectForSession = async (session: AcpRegistrySession): Promise<ProjectId | null> =>
    session.projectId ??
    findProjectByPath(environmentProjects, session.cwd)?.id ??
    createNativeProject(session.cwd, inferProjectTitleFromPath(session.cwd));

  const resume = async (
    instanceId: ProviderInstanceId,
    session: AcpRegistrySession,
    sessionScope: SessionScope,
  ) => {
    if (resuming) return;
    if (session.importedThreadId !== null) {
      props.onOpenThread(scopeThreadRef(environmentId, session.importedThreadId));
      return;
    }
    setResuming(true);
    const targetProjectId = sessionScope === "all" ? await projectForSession(session) : projectId;
    if (targetProjectId === null) {
      setResuming(false);
      return;
    }
    const result = await importSession({
      instanceId,
      projectId: targetProjectId,
      sessionId: session.sessionId,
      title: sessionTitle(session),
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
    const newId = await createNativeProject(cwd, title);
    if (newId !== null) openResumeSessionDialog(scopeProjectRef(environmentId, newId));
  };

  const normalizedQuery = query.trim().toLowerCase();
  const groups: CommandPaletteGroup[] = [];
  for (const entry of scopedInstances) {
    const state = byInstance[sessionsKey(scope, entry.instanceId)];
    const label =
      scope === "all"
        ? scopedInstances.length > 1
          ? `${entry.displayName} · All projects`
          : "All projects"
        : instances.length > 1
          ? entry.displayName
          : props.projectName;
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
      .map((session) => ({ session, title: sessionTitle(session) }))
      .filter(
        ({ session, title }) =>
          normalizedQuery.length === 0 ||
          title.toLowerCase().includes(normalizedQuery) ||
          (scope === "all" && session.cwd.toLowerCase().includes(normalizedQuery)) ||
          session.sessionId.toLowerCase().includes(normalizedQuery),
      )
      .toSorted(
        (left, right) => sessionUpdatedAtMs(right.session) - sessionUpdatedAtMs(left.session),
      )
      .map(({ session, title }): CommandPaletteActionItem => {
        const needsProject =
          scope === "all" &&
          session.projectId == null &&
          findProjectByPath(environmentProjects, session.cwd) === undefined;
        return {
          kind: "action",
          value: `resume-session:${entry.instanceId}:${session.sessionId}`,
          searchTerms: [title, session.sessionId, ...(scope === "all" ? [session.cwd] : [])],
          title,
          description:
            scope === "all"
              ? `${inferProjectTitleFromPath(session.cwd)} · ${sessionDescription(session)}`
              : sessionDescription(session),
          disabled:
            session.importedThreadId === null &&
            (!canImport || (needsProject && !canCreateProject)),
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
          run: () => resume(entry.instanceId, session, scope),
        };
      });
    if (items.length > 0) groups.push({ value: entry.instanceId, label, items });
  }
  for (const entry of scope === "all" ? [] : instances) {
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
  const hasMore = scopedInstances.some((entry) => {
    const state = byInstance[sessionsKey(scope, entry.instanceId)];
    return state?.status === "ready" && state.nextCursor !== null;
  });

  return (
    <CommandPaletteContent
      aria-label="Resume session"
      autoHighlight="always"
      escapeLabel="Close"
      footerActionLabel="Resume"
      footerTrailing={
        hasMore || canListAll ? (
          <>
            {canListAll ? (
              <CommandFooterAction onClick={toggleScope}>
                {scope === "all" ? "This project" : "All projects"}
              </CommandFooterAction>
            ) : null}
            {hasMore ? (
              <CommandFooterAction disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? "Loading…" : "Load more"}
              </CommandFooterAction>
            ) : null}
          </>
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
            : scope === "all"
              ? "No sessions found."
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
