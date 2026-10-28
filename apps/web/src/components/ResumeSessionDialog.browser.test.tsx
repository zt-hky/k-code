import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";

const commands = vi.hoisted(() => ({
  list: vi.fn(),
  import: vi.fn(),
  projects: vi.fn(),
  create: vi.fn(),
}));

vi.mock(import("../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const providers = Atom.make<ReadonlyArray<ServerProvider>>([
    {
      instanceId: "ohmypi",
      driver: "acpRegistry",
      displayName: "Oh My Pi",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: { status: "authenticated" },
      nativeSessions: {
        canList: true,
        canLoad: true,
        canResume: true,
        canDelete: false,
        canListProjects: true,
      },
      checkedAt: "2026-08-23T00:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
    } as unknown as ServerProvider,
  ]);
  const allowed = Atom.make(true);
  return {
    ...actual,
    providersIgnoringCheckedAtAtom: (() => providers) as never,
    serverEnvironment: {
      ...actual.serverEnvironment,
      importAcpRegistrySession: {
        ...actual.serverEnvironment.importAcpRegistrySession,
        permissionAtom: () => allowed,
      },
    },
  };
});
vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: (() => true) as never,
}));
vi.mock(import("../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => [
    { environmentId: "env", id: "project-omp", workspaceRoot: "/work/current" },
  ]) as never,
  waitForProject: vi.fn(async () => undefined) as never,
}));
vi.mock(import("../state/use-atom-command"), async (original) => {
  const { serverEnvironment } = await import("../state/server");
  const { projectEnvironment } = await import("../state/projects");
  return {
    ...(await original()),
    useAtomCommand: ((atom: unknown) =>
      atom === serverEnvironment.listAcpRegistrySessions
        ? commands.list
        : atom === serverEnvironment.importAcpRegistrySession
          ? commands.import
          : atom === serverEnvironment.listAcpRegistryProjects
            ? commands.projects
            : atom === projectEnvironment.create
              ? commands.create
              : vi.fn()) as never,
  };
});

import { appAtomRegistry } from "../rpc/atomRegistry";
import { ResumeSessionDialog } from "./ResumeSessionDialog";
import { resumeSessionDialogProjectAtom } from "./resumeSessionDialogState";

const environmentId = EnvironmentId.make("env");
const projectId = ProjectId.make("project-omp");
const instanceId = ProviderInstanceId.make("ohmypi");

const session = (
  sessionId: string,
  title: string | null,
  updatedAt: string,
  importedThreadId: ThreadId | null = null,
  messageCount?: number,
) => ({
  sessionId,
  cwd: "/workspace/omp",
  additionalDirectories: [],
  title,
  updatedAt,
  importedThreadId,
  ...(messageCount === undefined ? {} : { messageCount }),
});

function setup() {
  commands.projects.mockReset().mockResolvedValue({ _tag: "Success", value: { projects: [] } });
  commands.create.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  commands.list.mockReset().mockResolvedValue({
    _tag: "Success",
    value: {
      sessions: [
        session("aaaaaaaa-1111", "Fix flaky tests", "2026-08-20T00:00:00Z", null, 3),
        session("bbbbbbbb-2222", null, "2026-08-22T00:00:00Z"),
        session(
          "cccccccc-3333",
          "Refactor sidebar",
          "2026-08-21T00:00:00Z",
          ThreadId.make("t-open"),
        ),
      ],
      nextCursor: null,
      canLoad: true,
      canResume: true,
      canDelete: false,
    },
  });
  commands.import.mockReset().mockResolvedValue({
    _tag: "Success",
    value: { threadId: ThreadId.make("t-imported"), imported: true },
  });
}

it("lists native sessions newest first, filters, resumes and opens already-bound ones", async () => {
  setup();
  const onOpenThread = vi.fn();
  await using _screen = await render(
    <ResumeSessionDialog
      environmentId={environmentId}
      projectId={projectId}
      projectName="omp"
      open
      onOpenChange={vi.fn()}
      onOpenThread={onOpenThread}
    />,
  );

  await expect.element(page.getByText("Fix flaky tests")).toBeVisible();
  await expect.element(page.getByText("Untitled session")).toBeVisible();
  await expect.element(page.getByText("Open", { exact: true })).toBeVisible();
  expect(commands.list).toHaveBeenCalledWith({
    environmentId,
    input: { instanceId, projectId },
  });
  expect(
    page
      .getByRole("option")
      .elements()
      .map((element) => element.textContent),
  ).toEqual([
    expect.stringContaining("Untitled session"),
    expect.stringContaining("Refactor sidebar"),
    expect.stringContaining("Fix flaky tests"),
  ]);

  await userEvent.type(page.getByPlaceholder("Search sessions…"), "flaky");
  await expect.element(page.getByText("Refactor sidebar")).not.toBeInTheDocument();
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(onOpenThread).toHaveBeenCalledTimes(1));
  expect(commands.import).toHaveBeenCalledWith({
    environmentId,
    input: {
      instanceId,
      projectId,
      sessionId: "aaaaaaaa-1111",
      title: "Fix flaky tests",
      updatedAt: "2026-08-20T00:00:00Z",
    },
  });
  expect(onOpenThread).toHaveBeenLastCalledWith({
    environmentId,
    threadId: ThreadId.make("t-imported"),
  });

  await userEvent.clear(page.getByPlaceholder("Search sessions…"));
  await userEvent.click(page.getByText("Refactor sidebar"));
  await vi.waitFor(() => expect(onOpenThread).toHaveBeenCalledTimes(2));
  expect(commands.import).toHaveBeenCalledTimes(1);
  expect(onOpenThread).toHaveBeenLastCalledWith({
    environmentId,
    threadId: ThreadId.make("t-open"),
  });
});

it("offers agent projects not yet in T3 and adds one before reopening the dialog", async () => {
  setup();
  commands.projects.mockResolvedValue({
    _tag: "Success",
    value: {
      projects: [
        {
          cwd: "/work/current",
          sessionCount: 4,
          lastActivityAt: "2026-08-22T00:00:00.000Z",
          lastTitle: null,
        },
        {
          cwd: "/work/new",
          sessionCount: 2,
          lastActivityAt: "2026-08-21T00:00:00.000Z",
          lastTitle: "Ship it",
        },
      ],
    },
  });
  await using _screen = await render(
    <ResumeSessionDialog
      environmentId={environmentId}
      projectId={projectId}
      projectName="omp"
      open
      onOpenChange={vi.fn()}
      onOpenThread={vi.fn()}
    />,
  );

  await expect.element(page.getByText("Projects in Oh My Pi")).toBeVisible();
  await expect.element(page.getByText("/work/new")).toBeVisible();
  await expect.element(page.getByText("/work/current")).not.toBeInTheDocument();
  await expect.element(page.getByText("aaaaaaaa · 3 messages")).toBeVisible();
  expect(commands.projects).toHaveBeenCalledWith({ environmentId, input: { instanceId } });

  await userEvent.click(page.getByText("/work/new"));
  await vi.waitFor(() => expect(commands.create).toHaveBeenCalledTimes(1));
  expect(commands.create).toHaveBeenCalledWith({
    environmentId,
    input: expect.objectContaining({
      title: "new",
      workspaceRoot: "/work/new",
      createWorkspaceRootIfMissing: false,
      defaultModelSelection: null,
    }),
  });
  await vi.waitFor(() =>
    expect(appAtomRegistry.get(resumeSessionDialogProjectAtom)).toEqual({
      environmentId,
      projectId: commands.create.mock.calls[0]![0].input.projectId,
    }),
  );
});
