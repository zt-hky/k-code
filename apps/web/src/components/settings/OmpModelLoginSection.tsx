import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  OmpLoginProvider,
  OmpLoginState,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { CopyIcon } from "lucide-react";
import { useState } from "react";

import { reportAcpFailure } from "../../hooks/useAcpNativeSessions";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { ensureLocalApi } from "../../localApi";
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
  isSignedIn,
  loginPanel,
  promptNeedsRedirectHint,
  visibleLoginProviders,
} from "./OmpModelLoginSection.logic";

/** Signs Oh My Pi in to the model providers it supports, on the environment that runs it. */
export function OmpModelLoginSection(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly readOnly: boolean;
}) {
  const { environmentId, instanceId } = props;
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
  const [providers, setProviders] = useState<ReadonlyArray<OmpLoginProvider> | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [startedFlowId, setStartedFlowId] = useState<string | null>(null);
  const [dismissedFlowId, setDismissedFlowId] = useState<string | null>(null);
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ id: "", value: "" });
  const [submitting, setSubmitting] = useState(false);

  const panel = loginPanel(loginState, startedFlowId, dismissedFlowId);
  const flowActive = loginState?.phase === "starting" || loginState?.phase === "waiting";
  const controlsDisabled = props.readOnly || !canManage;
  const prompt = loginState?.prompt ?? null;
  const draftId = `${loginState?.flowId ?? ""}:${prompt?.id ?? ""}`;
  const draftValue = draft.id === draftId ? draft.value : "";
  const flowProviderName =
    providers?.find((provider) => provider.providerId === loginState?.providerId)?.name ??
    loginState?.providerId ??
    "the provider";

  const loadProviders = async () => {
    if (loading) return;
    setLoading(true);
    const result = await listProviders({ environmentId, input: { instanceId } });
    setLoading(false);
    if (result._tag === "Success") {
      setProviders(result.value.providers);
      return;
    }
    reportAcpFailure("Could not list Oh My Pi providers", result);
  };

  const signIn = async (provider: OmpLoginProvider) => {
    if (flowActive || busyProviderId !== null) return;
    setBusyProviderId(provider.providerId);
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
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Sign out of ${provider.name}? Oh My Pi will no longer be able to use it on this environment.`,
      { variant: "destructive" },
    );
    if (!confirmed) return;
    setBusyProviderId(provider.providerId);
    const result = await signOutLogin({
      environmentId,
      input: { instanceId, providerId: provider.providerId },
    });
    setBusyProviderId(null);
    if (result._tag !== "Success") {
      reportAcpFailure(`Could not sign out of ${provider.name}`, result);
      return;
    }
    setStartedFlowId(null);
    if (result.value.remainingSource === undefined) {
      toastManager.add({ type: "success", title: `Signed out of ${provider.name}` });
    } else {
      toastManager.add({
        type: "warning",
        title: `${provider.name} is still available`,
        description: `Oh My Pi still has ${result.value.remainingSource}.`,
      });
    }
    await loadProviders();
  };

  const openBrowser = async (url: string) => {
    try {
      await ensureLocalApi().shell.openExternal(url);
    } catch {
      toastManager.add({
        type: "error",
        title: "Could not open the sign-in page",
        description: "Copy the link and open it in your browser.",
      });
    }
  };

  const visible = providers === null ? [] : visibleLoginProviders(providers, filter);

  return (
    <div className="grid gap-3 border-t border-border/60 px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-foreground">Model providers</p>
          <p className="text-xs text-muted-foreground">
            Sign Oh My Pi in to the services whose models it can use. Credentials stay on this
            environment.
          </p>
        </div>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={controlsDisabled || loading || flowActive}
          onClick={() => void loadProviders()}
        >
          {loading ? "Loading" : providers === null ? "Show providers" : "Refresh"}
        </Button>
      </div>

      {panel !== "none" && loginState !== null ? (
        <div role="status" className="grid gap-2 rounded-md border border-border/60 p-3 text-xs">
          {panel === "active" ? (
            <>
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
              {loginState.authorizationUrl !== null ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={controlsDisabled}
                    onClick={() => void openBrowser(loginState.authorizationUrl!)}
                  >
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
                            void writeTextToClipboard(
                              loginState.authorizationUrl!,
                              "Provider sign-in link",
                            )
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
              {prompt !== null ? (
                <form
                  className="grid gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitPrompt(loginState);
                  }}
                >
                  <label className="grid gap-1">
                    {prompt.message}
                    <Input
                      size="sm"
                      type={prompt.secret ? "password" : "text"}
                      autoComplete="off"
                      spellCheck={false}
                      value={draftValue}
                      disabled={controlsDisabled || submitting}
                      maxLength={16_384}
                      onValueChange={(value) => setDraft({ id: draftId, value })}
                    />
                  </label>
                  {promptNeedsRedirectHint(prompt.message) ? (
                    <p className="text-muted-foreground">
                      After you approve, the browser may end on a localhost page that fails to load.
                      Copy that page&apos;s full address and paste it here.
                    </p>
                  ) : null}
                  <Button
                    type="submit"
                    size="xs"
                    variant="outline"
                    className="w-fit"
                    disabled={controlsDisabled || submitting}
                  >
                    {submitting ? "Sending" : "Continue"}
                  </Button>
                </form>
              ) : (
                <p className="text-muted-foreground">
                  {loginState.progress ?? "Waiting for Oh My Pi…"}
                </p>
              )}
            </>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p
                role={loginState.phase === "failed" ? "alert" : undefined}
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
              <Button
                type="button"
                size="xs"
                variant="ghost-muted"
                onClick={() => setDismissedFlowId(loginState.flowId)}
              >
                Dismiss
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {providers !== null ? (
        <>
          <Input
            size="sm"
            type="search"
            aria-label="Filter model providers"
            placeholder="Filter providers"
            value={filter}
            onValueChange={setFilter}
          />
          <div className="max-h-96 divide-y divide-border/60 overflow-y-auto border-y border-border/60">
            {visible.map((provider) => {
              const signedIn = isSignedIn(provider, loginState, startedFlowId);
              return (
                <div
                  key={provider.providerId}
                  className="flex items-center justify-between gap-2 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-xs font-medium text-foreground">{provider.name}</p>
                    {signedIn ? (
                      <Badge variant="success" size="sm">
                        Signed in
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={controlsDisabled || flowActive || busyProviderId !== null}
                      onClick={() => void signIn(provider)}
                    >
                      {signedIn ? "Sign in again" : "Sign in"}
                    </Button>
                    {signedIn ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost-muted"
                        disabled={controlsDisabled || flowActive || busyProviderId !== null}
                        onClick={() => void signOut(provider)}
                      >
                        Sign out
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {visible.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">No providers match.</p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
