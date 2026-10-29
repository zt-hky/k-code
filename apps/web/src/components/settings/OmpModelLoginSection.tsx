import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  OmpLoginProvider,
  OmpLoginState,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { CheckIcon, ChevronRightIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  authorizationHost,
  authorizationUrlToOpen,
  bridgeDeliveryTarget,
  canSubmitPrompt,
  chooseLoginWay,
  groupLoginProviders,
  isServiceSignedIn,
  localhostBridgeUrl,
  loginFlowStep,
  loginLocality,
  loginPanel,
  loginWayLabel,
  needsRefreshAfterSignIn,
  promptIsOptional,
  signOutWays,
} from "./OmpModelLoginSection.logic";
import { OmpLocalSignIns } from "./OmpLocalSignIns";
import { SecretInput } from "./SecretInput";

function ProviderRow(props: {
  readonly provider: OmpLoginProvider;
  readonly signedIn: boolean;
  readonly disabled: boolean;
  /** What the row's button starts; the service's own provider unless a way suits this browser better. */
  readonly primary?: OmpLoginProvider | undefined;
  /** Other ways into the same service, under "Other ways to sign in". */
  readonly others?: ReadonlyArray<OmpLoginProvider> | undefined;
  readonly onSignIn: (provider: OmpLoginProvider) => void;
  readonly onSignOut?: ((provider: OmpLoginProvider) => void) | undefined;
}) {
  const { provider, signedIn } = props;
  const [othersOpen, setOthersOpen] = useState(false);
  const others = props.others ?? [];
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-xs font-medium text-foreground">{provider.name}</p>
          {signedIn ? (
            <Badge variant="success" size="sm">
              Signed in
            </Badge>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {props.onSignOut ? (
            <Button
              type="button"
              size="xs"
              variant="ghost-muted"
              disabled={props.disabled}
              onClick={() => props.onSignOut?.(provider)}
            >
              Sign out
            </Button>
          ) : (
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={props.disabled}
              onClick={() => props.onSignIn(props.primary ?? provider)}
            >
              {signedIn ? "Sign in again" : "Sign in"}
            </Button>
          )}
        </div>
      </div>
      {others.length > 0 && !props.onSignOut ? (
        <div className="mt-1">
          <button
            type="button"
            aria-expanded={othersOpen}
            className="flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => setOthersOpen((open) => !open)}
          >
            <ChevronRightIcon
              className={`size-3 transition-transform ${othersOpen ? "rotate-90" : ""}`}
            />
            Other ways to sign in
          </button>
          {othersOpen ? (
            <div className="mt-1 flex flex-wrap gap-1.5 pl-4">
              {others.map((way) => (
                <Button
                  key={way.providerId}
                  type="button"
                  size="sm-multiline"
                  variant="outline"
                  disabled={props.disabled}
                  onClick={() => props.onSignIn(way)}
                >
                  {loginWayLabel(way)}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CopyCodeButton(props: { readonly code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      onClick={() =>
        void writeTextToClipboard(props.code, "Device code").then((didCopy) => setCopied(didCopy))
      }
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? "Copied" : "Copy code"}
    </Button>
  );
}

/**
 * Signs Oh My Pi in to the model providers it supports, on the environment that runs it. One
 * click on a provider starts a flow the server classifies as browser, device code, or API key.
 */
export function OmpModelLoginSection(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly readOnly: boolean;
}) {
  const { environmentId, instanceId } = props;
  const environment = useEnvironment(environmentId);
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const desktopBridge = window.desktopBridge;
  const locality = loginLocality({
    targetTag: environment?.entry.target._tag ?? null,
    httpBaseUrl,
    browserHostname: window.location.hostname,
    hasDesktopBridge: desktopBridge !== undefined,
  });
  const canManage = useAtomValue(serverEnvironment.startOmpLogin.permissionAtom(environmentId));
  const loginQuery = useEnvironmentQuery(
    canManage ? serverEnvironment.ompLoginState({ environmentId, input: { instanceId } }) : null,
  );
  const loginState = loginQuery.data;
  const listProviders = useAtomCommand(serverEnvironment.listOmpLoginProviders, {
    reportFailure: false,
  });
  const startLogin = useAtomCommand(serverEnvironment.startOmpLogin, { reportFailure: false });
  const respondLogin = useAtomCommand(serverEnvironment.respondOmpLogin, { reportFailure: false });
  const cancelLogin = useAtomCommand(serverEnvironment.cancelOmpLogin, { reportFailure: false });
  const signOutLogin = useAtomCommand(serverEnvironment.signOutOmpLogin, { reportFailure: false });
  const refreshServerProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [providers, setProviders] = useState<ReadonlyArray<OmpLoginProvider> | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [startedFlowId, setStartedFlowId] = useState<string | null>(null);
  const [dismissedFlowId, setDismissedFlowId] = useState<string | null>(null);
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ id: "", value: "" });
  const [submitting, setSubmitting] = useState(false);
  const [signOutNote, setSignOutNote] = useState<string | null>(null);
  // The desktop shell's listener for this flow's localhost redirect, and what it caught.
  const [bridgeFailedFlowId, setBridgeFailedFlowId] = useState<string | null>(null);
  const [caught, setCaught] = useState<{
    readonly flowId: string;
    readonly callbackUrl: string;
  } | null>(null);
  const deliveringFlowIdRef = useRef<string | null>(null);
  const openedFlowIdRef = useRef<string | null>(null);
  const refreshedFlowIdRef = useRef<string | null>(null);

  const panel = loginPanel(loginState, startedFlowId, dismissedFlowId);
  const flowActive = loginState?.phase === "starting" || loginState?.phase === "waiting";
  const controlsDisabled = props.readOnly || !canManage;
  const prompt = loginState?.prompt ?? null;
  const draftId = `${loginState?.flowId ?? ""}:${prompt?.id ?? ""}`;
  const draftValue = draft.id === draftId ? draft.value : "";
  const flowProvider = providers?.find(
    (provider) => provider.providerId === loginState?.providerId,
  );
  const flowProviderName = flowProvider?.name ?? loginState?.providerId ?? "the provider";

  const loadProviders = useStableCallback(async () => {
    setLoading(true);
    const result = await listProviders({ environmentId, input: { instanceId } });
    setLoading(false);
    if (result._tag === "Success") {
      setProviders(result.value.providers);
      return;
    }
    reportAcpFailure("Could not list Oh My Pi providers", result);
  });

  const openBrowser = useStableCallback(async (url: string, announceFailure: boolean) => {
    try {
      await ensureLocalApi().shell.openExternal(url);
    } catch {
      if (!announceFailure) return;
      toastManager.add({
        type: "error",
        title: "Could not open the sign-in page",
        description: "Copy the link and open it in your browser.",
      });
    }
  });

  const refreshAfterSignIn = useStableCallback(() => {
    void refreshServerProviders({ environmentId, input: { instanceId } });
    void loadProviders();
  });

  const bridgeUrl = localhostBridgeUrl(
    loginState,
    startedFlowId,
    locality,
    desktopBridge !== undefined,
  );
  const bridgeFlowId = loginState?.flowId ?? null;
  const delivery = bridgeDeliveryTarget(loginState, caught);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the desktop shell's loopback listener is an effect outside React that lives exactly as long as this sign-in
  useEffect(() => {
    if (bridgeUrl === null || bridgeFlowId === null || desktopBridge === undefined) return;
    let stopped = false;
    desktopBridge
      .receiveLocalhostAuthCallback(bridgeUrl)
      .then((result) => {
        if (stopped) return;
        if (result.status === "received") {
          setCaught({ flowId: bridgeFlowId, callbackUrl: result.callbackUrl });
        } else {
          setBridgeFailedFlowId(bridgeFlowId);
        }
      })
      .catch(() => {
        if (!stopped) setBridgeFailedFlowId(bridgeFlowId);
      });
    return () => {
      stopped = true;
      void desktopBridge.cancelLocalhostAuthCallback(bridgeUrl).catch(() => undefined);
    };
  }, [bridgeUrl, bridgeFlowId, desktopBridge]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands the caught redirect to the server's sign-in prompt once, then forgets it
  useEffect(() => {
    if (delivery === null || caught === null) return;
    if (deliveringFlowIdRef.current === caught.flowId) return;
    deliveringFlowIdRef.current = caught.flowId;
    void respondLogin({
      environmentId,
      input: {
        instanceId,
        flowId: delivery.flowId,
        promptId: delivery.promptId,
        value: caught.callbackUrl,
      },
    }).then((result) => {
      setCaught(null);
      if (result._tag === "Success") return;
      setBridgeFailedFlowId(delivery.flowId);
      reportAcpFailure("Could not pass the sign-in on to Oh My Pi", result);
    });
  }, [delivery, caught, environmentId, instanceId, respondLogin]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the provider list from the server when the panel mounts
  useEffect(() => {
    if (canManage) void loadProviders();
  }, [canManage, loadProviders]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens the sign-in page, an effect outside React, once per flow
  useEffect(() => {
    const url = authorizationUrlToOpen(loginState, startedFlowId, openedFlowIdRef.current);
    if (url === null) return;
    openedFlowIdRef.current = loginState?.flowId ?? null;
    void openBrowser(url, false);
  }, [loginState, startedFlowId, openBrowser]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the server's provider status and models change when this client's sign-in succeeds
  useEffect(() => {
    if (!needsRefreshAfterSignIn(loginState, startedFlowId, refreshedFlowIdRef.current)) return;
    refreshedFlowIdRef.current = loginState?.flowId ?? null;
    refreshAfterSignIn();
  }, [loginState, startedFlowId, refreshAfterSignIn]);

  const signIn = async (provider: OmpLoginProvider) => {
    if (flowActive || busyProviderId !== null) return;
    setBusyProviderId(provider.providerId);
    setSignOutNote(null);
    const result = await startLogin({
      environmentId,
      input: { instanceId, providerId: provider.providerId },
    });
    setBusyProviderId(null);
    if (result._tag === "Success") {
      setStartedFlowId(result.value.flowId);
      return;
    }
    reportAcpFailure(`Could not start signing in to ${provider.name}`, result);
  };

  const submitPrompt = async (state: OmpLoginState) => {
    if (state.flowId === null || state.prompt === null || submitting) return;
    if (!canSubmitPrompt(state.prompt, draftValue)) return;
    setSubmitting(true);
    const result = await respondLogin({
      environmentId,
      input: { instanceId, flowId: state.flowId, promptId: state.prompt.id, value: draftValue },
    });
    setSubmitting(false);
    if (result._tag === "Success") {
      setDraft({ id: "", value: "" });
      return;
    }
    reportAcpFailure("Could not send that to Oh My Pi", result);
  };

  const cancel = async (state: OmpLoginState) => {
    if (state.flowId === null) return;
    const result = await cancelLogin({
      environmentId,
      input: { instanceId, flowId: state.flowId },
    });
    if (result._tag !== "Success") reportAcpFailure("Could not cancel the sign-in", result);
  };

  const signOut = async (provider: OmpLoginProvider) => {
    if (flowActive || busyProviderId !== null) return;
    setBusyProviderId(provider.providerId);
    let remainingSource: string | undefined;
    for (const way of signOutWays(provider, providers ?? [], loginState, startedFlowId)) {
      const result = await signOutLogin({
        environmentId,
        input: { instanceId, providerId: way.providerId },
      });
      if (result._tag !== "Success") {
        setBusyProviderId(null);
        reportAcpFailure(`Could not sign out of ${provider.name}`, result);
        return;
      }
      remainingSource ??= result.value.remainingSource;
    }
    setBusyProviderId(null);
    setStartedFlowId(null);
    if (remainingSource === undefined) {
      toastManager.add({ type: "success", title: `Signed out of ${provider.name}` });
      setSignOutNote(null);
    } else {
      setSignOutNote(`${provider.name} is still signed in via ${remainingSource}.`);
    }
    refreshAfterSignIn();
  };

  const groups = groupLoginProviders(providers ?? [], filter, showAll);
  // One entry per service: ChatGPT's device-code variant counts toward ChatGPT.
  const services = groupLoginProviders(providers ?? [], "", true);
  const signedInProviders = [...services.popular, ...services.others].filter((provider) =>
    isServiceSignedIn(provider, providers ?? [], loginState, startedFlowId),
  );
  const rowDisabled = controlsDisabled || flowActive || busyProviderId !== null;
  const authorizationUrl = loginState?.authorizationUrl ?? null;
  const host = authorizationUrl === null ? null : authorizationHost(authorizationUrl);
  const step = loginState === null ? "starting" : loginFlowStep(loginState);
  const bridgeStatus =
    bridgeUrl === null
      ? null
      : bridgeFailedFlowId === loginState?.flowId
        ? "unavailable"
        : "listening";
  const caughtThisFlow = caught !== null && caught.flowId === loginState?.flowId;

  const promptForm =
    loginState !== null && prompt !== null ? (
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submitPrompt(loginState);
        }}
      >
        <label className="grid gap-1 text-xs text-foreground">
          {prompt.message}
          {prompt.secret ? (
            <SecretInput
              size="sm"
              font="mono"
              value={draftValue}
              disabled={controlsDisabled || submitting}
              maxLength={16_384}
              placeholder="Paste here"
              onValueChange={(value) => setDraft({ id: draftId, value })}
            />
          ) : (
            <Input
              size="sm"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={draftValue}
              disabled={controlsDisabled || submitting}
              maxLength={16_384}
              placeholder={step === "oauth" ? "Paste the address or code" : undefined}
              onValueChange={(value) => setDraft({ id: draftId, value })}
            />
          )}
        </label>
        <Button
          type="submit"
          size="xs"
          variant="outline"
          className="w-fit"
          disabled={controlsDisabled || submitting || !canSubmitPrompt(prompt, draftValue)}
        >
          {submitting
            ? "Sending"
            : promptIsOptional(prompt) && draftValue.trim() === ""
              ? "Skip"
              : "Continue"}
        </Button>
      </form>
    ) : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 px-3 py-3 sm:px-4">
      <div>
        <p className="text-xs font-medium text-foreground">Sign in to a model provider</p>
        <p className="text-xs text-muted-foreground">
          Oh My Pi uses the account you sign in to for its models. Credentials stay on this
          environment.
        </p>
      </div>

      {panel === "active" && loginState !== null ? (
        <div
          role="status"
          className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-md border border-border/60 p-3 text-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-2 font-medium text-foreground">
              <Spinner size="xs" tone="muted" />
              <span className="truncate">Signing in to {flowProviderName}</span>
            </p>
            <Button
              type="button"
              size="xs"
              variant="ghost-muted"
              disabled={controlsDisabled}
              onClick={() => void cancel(loginState)}
            >
              Cancel
            </Button>
          </div>

          {step === "device_code" ? (
            <div className="grid gap-2">
              {loginState.userCode !== null ? (
                <div className="flex flex-wrap items-center gap-3">
                  <code className="select-all font-mono text-3xl font-semibold tracking-widest text-foreground">
                    {loginState.userCode}
                  </code>
                  <CopyCodeButton code={loginState.userCode} />
                </div>
              ) : null}
              {authorizationUrl !== null ? (
                <Button
                  type="button"
                  size="sm"
                  className="w-fit"
                  disabled={controlsDisabled}
                  onClick={() => void openBrowser(authorizationUrl, true)}
                >
                  <ExternalLinkIcon />
                  {host === null ? "Open sign-in page" : `Open ${host}`}
                </Button>
              ) : null}
              <p className="text-muted-foreground">
                {host === null
                  ? "Waiting for you to approve it. Sign-in finishes on its own."
                  : `Approve it on ${host}, from any device. Sign-in finishes on its own.`}
              </p>
            </div>
          ) : step === "oauth" ? (
            <div className="grid gap-2">
              {authorizationUrl !== null ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    disabled={controlsDisabled}
                    onClick={() => void openBrowser(authorizationUrl, true)}
                  >
                    <ExternalLinkIcon />
                    Open sign-in page
                  </Button>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          aria-label="Copy sign-in link"
                          size="icon-sm"
                          variant="ghost-muted"
                          disabled={controlsDisabled}
                          onClick={() =>
                            void writeTextToClipboard(authorizationUrl, "Provider sign-in link")
                          }
                        >
                          <CopyIcon />
                        </Button>
                      }
                    />
                    <TooltipPopup>Copy sign-in link</TooltipPopup>
                  </Tooltip>
                </div>
              ) : null}
              {loginState.instructions !== null ? (
                <p className="whitespace-pre-line select-text text-muted-foreground [overflow-wrap:anywhere]">
                  {loginState.instructions}
                </p>
              ) : null}
              <p className="text-muted-foreground">
                {bridgeStatus === "listening" || caughtThisFlow
                  ? caughtThisFlow
                    ? "Got your sign-in. Finishing…"
                    : "Waiting for you to finish in the browser. This computer passes the result on, so sign-in finishes on its own."
                  : "Waiting for you to finish in the browser…"}
              </p>
              {promptForm !== null ? (
                <>
                  <p className="text-muted-foreground">
                    {bridgeStatus === "unavailable"
                      ? "This computer could not catch the sign-in (its sign-in port is busy). Paste the address your browser ended on."
                      : bridgeStatus === "listening"
                        ? "Not finishing on its own? Paste the address your browser ended on."
                        : "Signed in on another machine or the page cannot reach localhost? Paste the address your browser ended on."}
                  </p>
                  {promptForm}
                </>
              ) : null}
            </div>
          ) : step === "api_key" || step === "prompt" ? (
            <div className="grid gap-2">
              {step === "api_key" && authorizationUrl !== null ? (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  className="w-fit"
                  disabled={controlsDisabled}
                  onClick={() => void openBrowser(authorizationUrl, true)}
                >
                  <ExternalLinkIcon />
                  {host === null ? "Get an API key" : `Get a key at ${host}`}
                </Button>
              ) : null}
              {promptForm}
            </div>
          ) : (
            <p className="text-muted-foreground">{loginState.progress ?? "Starting…"}</p>
          )}
        </div>
      ) : null}

      {panel === "finished" && loginState !== null ? (
        <div
          role={loginState.phase === "failed" ? "alert" : "status"}
          className="flex items-center justify-between gap-2 rounded-md border border-border/60 p-3 text-xs"
        >
          <p
            className={
              loginState.phase === "failed"
                ? "text-destructive [overflow-wrap:anywhere]"
                : "text-foreground"
            }
          >
            {loginState.phase === "succeeded"
              ? `Signed in to ${flowProviderName}.`
              : loginState.phase === "cancelled"
                ? "Sign-in cancelled."
                : `Could not sign in to ${flowProviderName}. ${loginState.message ?? ""}`}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {loginState.phase === "failed" && flowProvider !== undefined ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={rowDisabled}
                onClick={() => void signIn(flowProvider)}
              >
                Retry
              </Button>
            ) : null}
            <Button
              type="button"
              size="xs"
              variant="ghost-muted"
              onClick={() => setDismissedFlowId(loginState.flowId)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      {panel !== "active" ? (
        <>
          {signedInProviders.length > 0 ? (
            <div className="grid gap-1">
              <p className="text-xs font-medium text-muted-foreground">Signed-in accounts</p>
              <div className="divide-y divide-border/60 border-y border-border/60">
                {signedInProviders.map((provider) => (
                  <ProviderRow
                    key={provider.providerId}
                    provider={provider}
                    signedIn
                    disabled={rowDisabled}
                    onSignIn={(next) => void signIn(next)}
                    onSignOut={(next) => void signOut(next)}
                  />
                ))}
              </div>
              {signOutNote !== null ? (
                <p role="status" className="text-xs text-muted-foreground">
                  {signOutNote}
                </p>
              ) : null}
            </div>
          ) : null}

          {providers === null ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <p>{loading ? "Loading providers…" : "Providers are not loaded."}</p>
              {loading ? null : (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost-muted"
                  disabled={controlsDisabled}
                  onClick={() => void loadProviders()}
                >
                  Retry
                </Button>
              )}
            </div>
          ) : (
            <div className="grid gap-2">
              <Input
                size="sm"
                type="search"
                aria-label="Search model providers"
                placeholder="Search all providers"
                value={filter}
                onValueChange={setFilter}
              />
              <div className="max-h-96 divide-y divide-border/60 overflow-y-auto border-y border-border/60">
                {[...groups.popular, ...groups.others].map((provider) => {
                  const choice = chooseLoginWay(provider, providers, locality);
                  return (
                    <ProviderRow
                      key={provider.providerId}
                      provider={provider}
                      signedIn={isServiceSignedIn(provider, providers, loginState, startedFlowId)}
                      disabled={rowDisabled}
                      primary={choice.primary}
                      others={choice.others}
                      onSignIn={(next) => void signIn(next)}
                    />
                  );
                })}
                {groups.popular.length + groups.others.length === 0 ? (
                  <p className="py-2 text-xs text-muted-foreground">No providers match.</p>
                ) : null}
              </div>
              {groups.hiddenCount > 0 ? (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost-muted"
                  className="w-fit"
                  onClick={() => setShowAll(true)}
                >
                  Show {groups.hiddenCount} more providers
                </Button>
              ) : null}
            </div>
          )}
          {locality === "remote" && desktopBridge !== undefined && providers !== null ? (
            <OmpLocalSignIns
              environmentId={environmentId}
              instanceId={instanceId}
              providers={providers}
              disabled={controlsDisabled || busyProviderId !== null}
              onImported={refreshAfterSignIn}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
