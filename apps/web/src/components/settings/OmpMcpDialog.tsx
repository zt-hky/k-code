import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  OmpMcpAuthState,
  OmpMcpInspectResult,
  OmpMcpListResult,
  OmpMcpServer,
  OmpMcpTestServerResult,
  ProjectId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  MoreHorizontalIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { reportAcpFailure } from "../../hooks/useAcpNativeSessions";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { useStableCallback } from "../../hooks/useStableCallback";
import { ensureLocalApi } from "../../localApi";
import { useEnvironment, useEnvironmentHttpBaseUrl } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  EMPTY_MCP_SERVER_DRAFT,
  buildAddServerInput,
  canAuthorizeServer,
  filterMcpServers,
  filterMcpSkills,
  isMcpAuthActive,
  isValidMcpServerName,
  mcpAuthBridgeUrl,
  mcpAuthSummary,
  visibleMcpAuthState,
  type McpServerDraft,
  type McpTransportChoice,
} from "./OmpMcpDialog.logic";
import { authorizationHost, loginLocality } from "./OmpModelLoginSection.logic";
import { SecretInput } from "./SecretInput";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const NO_PROJECT = "none";

interface McpProject {
  readonly id: ProjectId;
  readonly title: string;
}

type TestEntry = "pending" | OmpMcpTestServerResult;

const serverKey = (server: OmpMcpServer) => `${server.scope}:${server.name}`;

function McpAuthPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly state: OmpMcpAuthState;
  readonly startedFlowId: string | null;
  readonly controlsDisabled: boolean;
  readonly onDismiss: () => void;
}) {
  const { environmentId, instanceId, state, startedFlowId } = props;
  const environment = useEnvironment(environmentId);
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const desktopBridge = window.desktopBridge;
  const completeAuth = useAtomCommand(serverEnvironment.completeOmpMcpAuth, {
    reportFailure: false,
  });
  const cancelAuth = useAtomCommand(serverEnvironment.cancelOmpMcpAuth, { reportFailure: false });
  const [pasted, setPasted] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [bridgeFailedFlowId, setBridgeFailedFlowId] = useState<string | null>(null);
  const deliveredFlowIdRef = useRef<string | null>(null);

  const locality = loginLocality({
    targetTag: environment?.entry.target._tag ?? null,
    httpBaseUrl,
    browserHostname: window.location.hostname,
    hasDesktopBridge: desktopBridge !== undefined,
  });
  const bridgeUrl = mcpAuthBridgeUrl(state, startedFlowId, locality, desktopBridge !== undefined);
  const flowId = state.flowId;
  const active = isMcpAuthActive(state);
  const bridgeFailed = flowId !== null && bridgeFailedFlowId === flowId;
  const authorizationUrl = state.authorizationUrl;
  const host = authorizationUrl === null ? null : authorizationHost(authorizationUrl);

  const completeWith = useStableCallback(async (callbackUrl: string) => {
    if (flowId === null) return false;
    const result = await completeAuth({
      environmentId,
      input: { instanceId, flowId, callbackUrl },
    });
    if (result._tag === "Success") return true;
    reportAcpFailure("Could not finish authorizing", result);
    return false;
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the desktop shell's loopback listener is an effect outside React that lives exactly as long as this authorization
  useEffect(() => {
    if (bridgeUrl === null || flowId === null || desktopBridge === undefined) return;
    let stopped = false;
    desktopBridge
      .receiveLocalhostAuthCallback(bridgeUrl)
      .then((result) => {
        if (stopped) return;
        if (result.status !== "received") {
          setBridgeFailedFlowId(flowId);
          return;
        }
        if (deliveredFlowIdRef.current === flowId) return;
        deliveredFlowIdRef.current = flowId;
        void completeWith(result.callbackUrl).then((delivered) => {
          if (!delivered) setBridgeFailedFlowId(flowId);
        });
      })
      .catch(() => {
        if (!stopped) setBridgeFailedFlowId(flowId);
      });
    return () => {
      stopped = true;
      void desktopBridge.cancelLocalhostAuthCallback(bridgeUrl).catch(() => undefined);
    };
  }, [bridgeUrl, flowId, desktopBridge, completeWith]);

  const openPage = async () => {
    if (authorizationUrl === null) return;
    try {
      await ensureLocalApi().shell.openExternal(authorizationUrl);
    } catch {
      toastManager.add({
        type: "error",
        title: "Could not open the authorization page",
        description: "Copy the link and open it in your browser.",
      });
    }
  };

  const submitPasted = async () => {
    const callbackUrl = pasted.trim();
    if (callbackUrl === "" || submitting) return;
    setSubmitting(true);
    const delivered = await completeWith(callbackUrl);
    setSubmitting(false);
    if (delivered) setPasted("");
  };

  const cancel = async () => {
    if (flowId === null) return;
    const result = await cancelAuth({ environmentId, input: { instanceId, flowId } });
    if (result._tag !== "Success") reportAcpFailure("Could not cancel the authorization", result);
  };

  const needsPaste = active && locality === "remote" && authorizationUrl !== null;

  return (
    <section
      aria-label="Authorization"
      className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border border-border/60 bg-muted/30 p-3"
    >
      <div className="flex min-w-0 items-center gap-2 text-sm">
        {active ? <Spinner className="size-4 shrink-0" /> : null}
        {state.phase === "succeeded" ? (
          <CheckIcon className="size-4 shrink-0 text-success" />
        ) : null}
        <span
          className={cn(
            "min-w-0 wrap-anywhere",
            state.phase === "failed" && "text-destructive-foreground",
          )}
        >
          {mcpAuthSummary(state)}
        </span>
      </div>
      {active && authorizationUrl !== null ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="xs" onClick={() => void openPage()}>
            <ExternalLinkIcon />
            Open authorization page
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() =>
              void writeTextToClipboard(authorizationUrl, "Authorization link").then((didCopy) =>
                setCopied(didCopy),
              )
            }
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          {host !== null ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground">{host}</span>
          ) : null}
        </div>
      ) : null}
      {needsPaste ? (
        <form
          className="grid grid-cols-[minmax(0,1fr)] gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submitPasted();
          }}
        >
          <label className="grid gap-1 text-xs text-foreground">
            {bridgeUrl !== null && !bridgeFailed
              ? "Not finishing on its own? Paste the address your browser ended on."
              : "Paste the address your browser ended on"}
            <span className="flex min-w-0 gap-2">
              <Input
                size="sm"
                className="min-w-0 flex-1"
                value={pasted}
                spellCheck={false}
                autoComplete="off"
                placeholder="http://localhost:…/callback?code=…"
                disabled={props.controlsDisabled || submitting}
                onChange={(event) => setPasted(event.target.value)}
              />
              <Button
                type="submit"
                size="sm"
                disabled={props.controlsDisabled || submitting || pasted.trim() === ""}
              >
                {submitting ? <Spinner className="size-3.5" /> : null}
                Finish
              </Button>
            </span>
          </label>
        </form>
      ) : null}
      <div className="flex justify-end gap-2">
        {active ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={props.controlsDisabled}
            onClick={() => void cancel()}
          >
            Cancel
          </Button>
        ) : (
          <Button type="button" size="xs" variant="outline" onClick={props.onDismiss}>
            Dismiss
          </Button>
        )}
      </div>
    </section>
  );
}

function AddServerForm(props: {
  readonly draft: McpServerDraft;
  readonly projectSelected: boolean;
  readonly submitting: boolean;
  readonly error: string | null;
  readonly onChange: (draft: McpServerDraft) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}) {
  const { draft } = props;
  const nameInvalid = draft.name.trim() !== "" && !isValidMcpServerName(draft.name.trim());
  return (
    <form
      aria-label="Add MCP server"
      className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-lg border border-border/60 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
        <label className="grid min-w-0 gap-1 text-xs font-medium text-foreground">
          Name
          <Input
            size="sm"
            value={draft.name}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={nameInvalid || undefined}
            placeholder="my-server"
            disabled={props.submitting}
            onChange={(event) => props.onChange({ ...draft, name: event.target.value })}
          />
          {nameInvalid ? (
            <span className="font-normal text-destructive-foreground">
              Letters, numbers, dots, dashes, and underscores; start with a letter or number.
            </span>
          ) : null}
        </label>
        <div className="grid min-w-0 gap-1 text-xs font-medium text-foreground">
          Scope
          <ToggleGroup
            aria-label="Scope"
            variant="segmented"
            value={[draft.scope]}
            disabled={props.submitting}
            onValueChange={(next) => {
              const value = next[0];
              if (value === "user" || (value === "project" && props.projectSelected)) {
                props.onChange({ ...draft, scope: value });
              }
            }}
          >
            <Toggle value="user">User</Toggle>
            <Toggle value="project" disabled={!props.projectSelected}>
              Project
            </Toggle>
          </ToggleGroup>
        </div>
      </div>
      <div className="grid min-w-0 gap-1 text-xs font-medium text-foreground">
        Transport
        <ToggleGroup
          aria-label="Transport"
          variant="segmented"
          value={[draft.transport]}
          disabled={props.submitting}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "http" || value === "sse" || value === "stdio") {
              props.onChange({ ...draft, transport: value satisfies McpTransportChoice });
            }
          }}
        >
          <Toggle value="http">HTTP</Toggle>
          <Toggle value="sse">SSE</Toggle>
          <Toggle value="stdio">Command</Toggle>
        </ToggleGroup>
      </div>
      {draft.transport === "stdio" ? (
        <label className="grid min-w-0 gap-1 text-xs font-medium text-foreground">
          Command
          <Input
            size="sm"
            className="min-w-0"
            value={draft.commandLine}
            spellCheck={false}
            autoComplete="off"
            placeholder="npx -y @modelcontextprotocol/server-everything"
            disabled={props.submitting}
            onChange={(event) => props.onChange({ ...draft, commandLine: event.target.value })}
          />
        </label>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1 text-xs font-medium text-foreground">
            URL
            <Input
              size="sm"
              type="url"
              value={draft.url}
              spellCheck={false}
              autoComplete="off"
              placeholder="https://example.com/mcp"
              disabled={props.submitting}
              onChange={(event) => props.onChange({ ...draft, url: event.target.value })}
            />
          </label>
          <label className="grid min-w-0 gap-1 text-xs font-medium text-foreground">
            Bearer token (optional)
            <SecretInput
              size="sm"
              value={draft.token}
              placeholder="Not set"
              disabled={props.submitting}
              onChange={(event) => props.onChange({ ...draft, token: event.target.value })}
            />
          </label>
        </div>
      )}
      {props.error !== null ? (
        <p className="text-xs text-destructive-foreground">{props.error}</p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={props.submitting}
          onClick={props.onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={props.submitting}>
          {props.submitting ? <Spinner className="size-3.5" /> : <PlusIcon />}
          Add server
        </Button>
      </div>
    </form>
  );
}

function TestResultView(props: { readonly entry: TestEntry }) {
  const { entry } = props;
  if (entry === "pending") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner className="size-3.5" />
        Connecting…
      </div>
    );
  }
  if (!entry.connected) {
    return (
      <p className="wrap-anywhere text-xs text-destructive-foreground">
        {entry.message ?? "Could not connect."}
      </p>
    );
  }
  return (
    <div className="grid min-w-0 gap-1.5">
      <span className="flex items-center gap-1.5 text-xs text-success-foreground">
        <CheckIcon className="size-3.5" />
        Connected · {entry.tools.length} {entry.tools.length === 1 ? "tool" : "tools"}
      </span>
      {entry.tools.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {entry.tools.map((tool) => (
            <Badge key={tool} size="sm" variant="secondary" className="max-w-full">
              <span className="truncate">{tool}</span>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ServerRow(props: {
  readonly server: OmpMcpServer;
  readonly test: TestEntry | undefined;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly authActive: boolean;
  readonly onToggle: (enabled: boolean) => void;
  readonly onTest: () => void;
  readonly onAuthorize: () => void;
  readonly onRemove: () => void;
}) {
  const { server } = props;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)] gap-2 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {server.name}
            </span>
            <Badge size="sm" variant="outline">
              {server.transport}
            </Badge>
            <Badge size="sm" variant="secondary">
              {server.scope === "user" ? "User" : "Project"}
            </Badge>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {server.target}
                </span>
              }
            />
            <TooltipPopup variant="code" className="max-w-sm wrap-anywhere">
              {server.target}
            </TooltipPopup>
          </Tooltip>
        </div>
        <Switch
          size="sm"
          aria-label={`${server.enabled ? "Disable" : "Enable"} ${server.name}`}
          checked={server.enabled}
          disabled={props.disabled || props.busy}
          onCheckedChange={(checked) => props.onToggle(checked)}
        />
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Actions for ${server.name}`}
                disabled={props.disabled || props.busy}
              />
            }
          >
            <MoreHorizontalIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={props.onTest}>
              <PlayIcon />
              Test connection
            </MenuItem>
            {canAuthorizeServer(server) ? (
              <MenuItem disabled={props.authActive} onClick={props.onAuthorize}>
                <KeyRoundIcon />
                Authorize
              </MenuItem>
            ) : null}
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={props.onRemove}>
              <Trash2Icon />
              Remove
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      {props.test !== undefined ? <TestResultView entry={props.test} /> : null}
    </li>
  );
}

function ResourcesAndPrompts(props: {
  readonly inspect: OmpMcpInspectResult | null;
  readonly loading: boolean;
  readonly onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) props.onOpen();
      }}
    >
      <CollapsibleTrigger className="flex min-h-9 w-full items-center gap-2 rounded-md text-left text-xs font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        Resources & prompts
        {props.loading ? <Spinner className="size-3.5" /> : null}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 pb-1 pl-6">
          {props.inspect === null ? (
            <p className="text-xs text-muted-foreground">
              {props.loading ? "Connecting to servers…" : "Nothing loaded yet."}
            </p>
          ) : (
            <>
              <div className="grid gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Resources ({props.inspect.resources.length})
                </span>
                {props.inspect.resources.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No resources on connected servers.
                  </p>
                ) : (
                  <ul className="grid gap-1">
                    {props.inspect.resources.map((resource) => (
                      <li
                        key={`${resource.server}/${resource.uri}`}
                        className="flex min-w-0 items-center gap-1.5 text-xs"
                      >
                        <Badge size="sm" variant="outline" className="shrink-0">
                          {resource.server}
                        </Badge>
                        <span className="truncate font-mono text-muted-foreground">
                          {resource.uri}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="grid gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Prompts ({props.inspect.prompts.length})
                </span>
                {props.inspect.prompts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No prompts on connected servers.</p>
                ) : (
                  <ul className="grid gap-1">
                    {props.inspect.prompts.map((prompt) => (
                      <li
                        key={`${prompt.server}/${prompt.name}`}
                        className="min-w-0 text-xs wrap-anywhere"
                      >
                        <span className="font-mono text-foreground">
                          {prompt.server}/{prompt.name}
                        </span>
                        {prompt.description !== undefined ? (
                          <span className="text-muted-foreground"> · {prompt.description}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function OmpMcpBody(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly projects: ReadonlyArray<McpProject>;
  readonly readOnly: boolean;
}) {
  const { environmentId, instanceId } = props;
  const canManage = useAtomValue(serverEnvironment.addOmpMcpServer.permissionAtom(environmentId));
  const controlsDisabled = props.readOnly || !canManage;
  const listMcp = useAtomCommand(serverEnvironment.listOmpMcp, { reportFailure: false });
  const addServer = useAtomCommand(serverEnvironment.addOmpMcpServer, { reportFailure: false });
  const removeServer = useAtomCommand(serverEnvironment.removeOmpMcpServer, {
    reportFailure: false,
  });
  const setEnabled = useAtomCommand(serverEnvironment.setOmpMcpServerEnabled, {
    reportFailure: false,
  });
  const testServer = useAtomCommand(serverEnvironment.testOmpMcpServer, { reportFailure: false });
  const inspectMcp = useAtomCommand(serverEnvironment.inspectOmpMcp, { reportFailure: false });
  const startAuth = useAtomCommand(serverEnvironment.startOmpMcpAuth, { reportFailure: false });

  const [projectSelection, setProjectSelection] = useState<string>(NO_PROJECT);
  const projectId = props.projects.find((project) => project.id === projectSelection)?.id ?? null;
  const [tab, setTab] = useState<"servers" | "skills">("servers");
  const [data, setData] = useState<OmpMcpListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverFilter, setServerFilter] = useState("");
  const [skillFilter, setSkillFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<McpServerDraft>(EMPTY_MCP_SERVER_DRAFT);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [tests, setTests] = useState<Readonly<Record<string, TestEntry>>>({});
  const [inspect, setInspect] = useState<OmpMcpInspectResult | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectOpened, setInspectOpened] = useState(false);
  const [startedFlowId, setStartedFlowId] = useState<string | null>(null);
  const [dismissedFlowId, setDismissedFlowId] = useState<string | null>(null);
  const requestRef = useRef(0);

  const authQuery = useEnvironmentQuery(
    canManage ? serverEnvironment.ompMcpAuthState({ environmentId, input: { instanceId } }) : null,
  );
  const authState = visibleMcpAuthState(authQuery.data, startedFlowId, dismissedFlowId);
  const authActive = isMcpAuthActive(authQuery.data);

  const loadInspect = useStableCallback(async (inspectProjectId: ProjectId | null) => {
    const request = requestRef.current;
    setInspectLoading(true);
    const result = await inspectMcp({
      environmentId,
      input: { instanceId, ...(inspectProjectId === null ? {} : { projectId: inspectProjectId }) },
    });
    if (request !== requestRef.current) return;
    setInspectLoading(false);
    if (result._tag === "Success") {
      setInspect(result.value);
      return;
    }
    reportAcpFailure("Could not load MCP resources and prompts", result);
  });

  const load = useStableCallback(async (listProjectId: ProjectId | null) => {
    const request = ++requestRef.current;
    setLoading(true);
    setLoadError(null);
    setTests({});
    setInspect(null);
    setInspectLoading(false);
    const result = await listMcp({
      environmentId,
      input: { instanceId, ...(listProjectId === null ? {} : { projectId: listProjectId }) },
    });
    if (request !== requestRef.current) return;
    setLoading(false);
    if (result._tag === "Success") {
      setData(result.value);
      if (inspectOpened) void loadInspect(listProjectId);
      return;
    }
    setLoadError("Could not load MCP servers.");
    reportAcpFailure("Could not load MCP servers", result);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the servers from Oh My Pi when the dialog opens and whenever the project changes
  useEffect(() => {
    if (canManage) void load(projectId);
  }, [canManage, projectId, load]);

  const reloadQuietly = useStableCallback(async () => {
    const request = ++requestRef.current;
    const result = await listMcp({
      environmentId,
      input: { instanceId, ...(projectId === null ? {} : { projectId }) },
    });
    if (request !== requestRef.current) return;
    if (result._tag === "Success") setData(result.value);
    else reportAcpFailure("Could not reload MCP servers", result);
  });

  const target = { instanceId, ...(projectId === null ? {} : { projectId }) };

  const submitDraft = async () => {
    if (submitting) return;
    const built = buildAddServerInput(draft, { instanceId, projectId });
    if (!built.ok) {
      setDraftError(built.reason);
      return;
    }
    setDraftError(null);
    setSubmitting(true);
    const result = await addServer({ environmentId, input: built.input });
    setSubmitting(false);
    if (result._tag !== "Success") {
      reportAcpFailure("Could not add the MCP server", result);
      return;
    }
    toastManager.add({ type: "success", title: result.value.message });
    setDraft(EMPTY_MCP_SERVER_DRAFT);
    setAdding(false);
    await reloadQuietly();
  };

  const toggle = async (server: OmpMcpServer, enabled: boolean) => {
    setBusyKey(serverKey(server));
    const result = await setEnabled({
      environmentId,
      input: { ...target, name: server.name, enabled },
    });
    setBusyKey(null);
    if (result._tag !== "Success") {
      reportAcpFailure(`Could not ${enabled ? "enable" : "disable"} ${server.name}`, result);
      return;
    }
    toastManager.add({ type: "success", title: result.value.message });
    await reloadQuietly();
  };

  const test = async (server: OmpMcpServer) => {
    const key = serverKey(server);
    setTests((current) => ({ ...current, [key]: "pending" }));
    const result = await testServer({ environmentId, input: { ...target, name: server.name } });
    if (result._tag === "Success") {
      setTests((current) => ({ ...current, [key]: result.value }));
      return;
    }
    setTests((current) => {
      const { [key]: _removed, ...rest } = current;
      return rest;
    });
    reportAcpFailure(`Could not test ${server.name}`, result);
  };

  const authorize = async (server: OmpMcpServer) => {
    if (authActive) return;
    setDismissedFlowId(null);
    const result = await startAuth({ environmentId, input: { ...target, name: server.name } });
    if (result._tag === "Success") {
      setStartedFlowId(result.value.flowId);
      return;
    }
    reportAcpFailure(`Could not start authorizing ${server.name}`, result);
  };

  const remove = async (server: OmpMcpServer) => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Remove MCP server "${server.name}" from the ${server.scope} configuration?`,
      { variant: "destructive" },
    );
    if (!confirmed) return;
    setBusyKey(serverKey(server));
    const result = await removeServer({
      environmentId,
      input: { ...target, name: server.name, scope: server.scope },
    });
    setBusyKey(null);
    if (result._tag !== "Success") {
      reportAcpFailure(`Could not remove ${server.name}`, result);
      return;
    }
    toastManager.add({ type: "success", title: result.value.message });
    await reloadQuietly();
  };

  const servers = data?.servers ?? [];
  const skills = data?.skills ?? [];
  const visibleServers = filterMcpServers(servers, serverFilter);
  const visibleSkills = filterMcpSkills(skills, skillFilter);
  const selectedProjectTitle =
    props.projects.find((project) => project.id === projectId)?.title ??
    "No project (user servers)";

  return (
    <>
      <DialogHeader>
        <DialogTitle>Oh My Pi · MCP & skills</DialogTitle>
        <DialogDescription>
          Servers and skills Oh My Pi loads. Everything here runs through Oh My Pi itself.
        </DialogDescription>
        <div className="flex min-w-0 flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-muted-foreground">Project</span>
          <Select
            value={projectSelection}
            disabled={!canManage || submitting}
            onValueChange={(value) => {
              if (typeof value === "string") {
                setProjectSelection(value);
                setDraft((current) => ({
                  ...current,
                  scope: value === NO_PROJECT ? "user" : current.scope,
                }));
              }
            }}
          >
            <SelectTrigger aria-label="Project" className="w-64 max-w-full" size="sm">
              <SelectValue>{selectedProjectTitle}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value={NO_PROJECT}>No project (user servers)</SelectItem>
              {props.projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      </DialogHeader>
      <DialogPanel className="grid grid-cols-[minmax(0,1fr)]">
        <ToggleGroup
          aria-label="MCP and skills"
          variant="segmented"
          value={[tab]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "servers" || value === "skills") setTab(value);
          }}
        >
          <Toggle value="servers">MCP servers ({servers.length})</Toggle>
          <Toggle value="skills">Skills ({skills.length})</Toggle>
        </ToggleGroup>

        {!canManage ? (
          <p className="text-sm text-muted-foreground">
            You do not have permission to manage Oh My Pi on this environment.
          </p>
        ) : tab === "servers" ? (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Input
                size="sm"
                className="min-w-0 flex-1 basis-40"
                aria-label="Filter servers"
                placeholder="Filter servers"
                value={serverFilter}
                onChange={(event) => setServerFilter(event.target.value)}
              />
              <Button
                type="button"
                size="sm"
                disabled={controlsDisabled || adding}
                onClick={() => setAdding(true)}
              >
                <PlusIcon />
                Add server
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={loading}
                onClick={() => void load(projectId)}
              >
                {loading ? <Spinner className="size-3.5" /> : <RefreshCwIcon />}
                Refresh
              </Button>
            </div>

            {adding ? (
              <AddServerForm
                draft={draft}
                projectSelected={projectId !== null}
                submitting={submitting}
                error={draftError}
                onChange={setDraft}
                onSubmit={() => void submitDraft()}
                onCancel={() => {
                  setAdding(false);
                  setDraftError(null);
                }}
              />
            ) : null}

            {authState !== null ? (
              <McpAuthPanel
                key={authState.flowId}
                environmentId={environmentId}
                instanceId={instanceId}
                state={authState}
                startedFlowId={startedFlowId}
                controlsDisabled={controlsDisabled}
                onDismiss={() => setDismissedFlowId(authState.flowId)}
              />
            ) : null}

            {loadError !== null && data === null ? (
              <p className="text-sm text-destructive-foreground">{loadError}</p>
            ) : data === null ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Asking Oh My Pi for its servers…
              </div>
            ) : visibleServers.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {servers.length === 0
                  ? "No MCP servers configured."
                  : "No servers match that filter."}
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {visibleServers.map((server) => (
                  <ServerRow
                    key={serverKey(server)}
                    server={server}
                    test={tests[serverKey(server)]}
                    busy={busyKey === serverKey(server)}
                    disabled={controlsDisabled}
                    authActive={authActive}
                    onToggle={(enabled) => void toggle(server, enabled)}
                    onTest={() => void test(server)}
                    onAuthorize={() => void authorize(server)}
                    onRemove={() => void remove(server)}
                  />
                ))}
              </ul>
            )}

            <ResourcesAndPrompts
              inspect={inspect}
              loading={inspectLoading}
              onOpen={() => {
                setInspectOpened(true);
                void loadInspect(projectId);
              }}
            />
          </div>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <p className="text-xs text-muted-foreground">
              These are the skills Oh My Pi loads. They are read-only here.
            </p>
            <Input
              size="sm"
              aria-label="Filter skills"
              placeholder="Filter skills"
              value={skillFilter}
              onChange={(event) => setSkillFilter(event.target.value)}
            />
            {data === null ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Asking Oh My Pi for its skills…
              </div>
            ) : visibleSkills.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {skills.length === 0 ? "No skills loaded." : "No skills match that filter."}
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {visibleSkills.map((skill) => (
                  <li key={skill.name} className="grid min-w-0 gap-0.5 py-2.5">
                    <span className="truncate font-mono text-sm text-foreground">{skill.name}</span>
                    {skill.description !== undefined && skill.description !== "" ? (
                      <span className="text-xs wrap-anywhere text-muted-foreground">
                        {skill.description}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogPanel>
      <DialogFooter>
        <p className="text-xs text-muted-foreground sm:mr-auto sm:self-center">
          Changes apply to new sessions. In a running thread, send /mcp reload.
        </p>
      </DialogFooter>
    </>
  );
}

function OmpMcpDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly projects: ReadonlyArray<McpProject>;
  readonly readOnly: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-h-[85dvh] w-full sm:max-w-3xl">
        <OmpMcpBody
          environmentId={props.environmentId}
          instanceId={props.instanceId}
          projects={props.projects}
          readOnly={props.readOnly}
        />
      </DialogPopup>
    </Dialog>
  );
}

export function OmpMcpSettingsRow(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly projects: ReadonlyArray<McpProject>;
  readonly readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <SettingsSection title="MCP servers & skills">
      <SettingsRow
        title="Oh My Pi MCP and skills"
        description="Add, test, and authorize the MCP servers Oh My Pi uses, and see the skills it loads."
        control={
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
            Manage
          </Button>
        }
      />
      {open ? <OmpMcpDialog {...props} open={open} onOpenChange={setOpen} /> : null}
    </SettingsSection>
  );
}
