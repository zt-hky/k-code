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

const commands = vi.hoisted(() => ({ list: vi.fn(), import: vi.fn() }));

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
      nativeSessions: { canList: true, canLoad: true, canResume: true, canDelete: false },
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
vi.mock(import("../state/use-atom-command"), async (original) => {
  const { serverEnvironment } = await import("../state/server");
  return {
    ...(await original()),
    useAtomCommand: ((atom: unknown) =>
      atom === serverEnvironment.listAcpRegistrySessions
        ? commands.list
        : atom === serverEnvironment.importAcpRegistrySession
          ? commands.import
          : vi.fn()) as never,
  };
});

import { ResumeSessionDialog } from "./ResumeSessionDialog";

const environmentId = EnvironmentId.make("env");
const projectId = ProjectId.make("project-omp");
const instanceId = ProviderInstanceId.make("ohmypi");

const session = (
  sessionId: string,
  title: string | null,
  updatedAt: string,
  importedThreadId: ThreadId | null = null,
) => ({
  sessionId,
  cwd: "/workspace/omp",
  additionalDirectories: [],
  title,
  updatedAt,
  importedThreadId,
});

function setup() {
  commands.list.mockReset().mockResolvedValue({
    _tag: "Success",
    value: {
      sessions: [
        session("aaaaaaaa-1111", "Fix flaky tests", "2026-08-20T00:00:00Z"),
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
