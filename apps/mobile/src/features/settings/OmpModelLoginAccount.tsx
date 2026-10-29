import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { OmpLoginProvider, OmpLoginState, ServerProvider } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { TextInput, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { ControlPill } from "../../components/ui/ControlPill";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  canSubmitPrompt,
  loginFlowStep,
  isServiceSignedIn,
  loginWays,
  preferredLoginProvider,
  signedInServices,
  visibleLoginProviders,
} from "./ompModelLogin";
import type { SettingsTarget } from "./settings-environment-filter";

/** Signs Oh My Pi in to the model providers it supports, on the environment that runs it. */
export function OmpModelLoginAccount(props: {
  readonly environment: SettingsTarget;
  readonly provider: ServerProvider;
  readonly divider: boolean;
}) {
  const { environmentId } = props.environment;
  const instanceId = props.provider.instanceId;
  const target = { environmentId, input: { instanceId } };
  const options = { reportFailure: false, reportDefect: false };
  const loginQuery = useEnvironmentQuery(serverEnvironment.ompLoginState(target));
  const listProviders = useAtomCommand(serverEnvironment.listOmpLoginProviders, options);
  const startLogin = useAtomCommand(serverEnvironment.startOmpLogin, options);
  const respondLogin = useAtomCommand(serverEnvironment.respondOmpLogin, options);
  const cancelLogin = useAtomCommand(serverEnvironment.cancelOmpLogin, options);
  const signOutLogin = useAtomCommand(serverEnvironment.signOutOmpLogin, options);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, options);
  const state = loginQuery.data;
  const [providers, setProviders] = useState<ReadonlyArray<OmpLoginProvider> | null>(null);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [startedFlowId, setStartedFlowId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ id: "", value: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const openedFlowIdRef = useRef<string | null>(null);
  const refreshedFlowIdRef = useRef<string | null>(null);
  const active = state?.phase === "starting" || state?.phase === "waiting";
  const prompt = state?.prompt ?? null;
  const draftId = `${state?.flowId ?? ""}:${prompt?.id ?? ""}`;
  const draftValue = draft.id === draftId ? draft.value : "";
  const step = state === null ? "starting" : loginFlowStep(state);
  const flowProviderName =
    providers?.find((entry) => entry.providerId === state?.providerId)?.name ??
    state?.providerId ??
    "the provider";
  const startedByThisClient = state?.flowId != null && state.flowId === startedFlowId;
  const succeeded = state?.phase === "succeeded" && startedByThisClient;
  const failed = state?.phase === "failed" && startedByThisClient ? state : null;

  async function run(command: () => Promise<AtomCommandResult<unknown, unknown>>) {
    if (pending) return false;
    setPending(true);
    setError(null);
    const result = await command();
    setPending(false);
    if (result._tag === "Success") return true;
    if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Could not update sign-in.");
    }
    return false;
  }

  const loadProviders = useEffectEvent(async () => {
    const result = await listProviders(target);
    if (result._tag === "Success") setProviders(result.value.providers);
    else if (!isAtomCommandInterrupted(result)) setError("Could not list model providers.");
  });
  const refreshAfterSignIn = useEffectEvent(() => {
    void refreshProviders(target);
    void loadProviders();
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the provider list from the server when the row mounts
  useEffect(() => {
    let cancelled = false;
    void listProviders({ environmentId, input: { instanceId } }).then((result) => {
      if (cancelled) return;
      if (result._tag === "Success") setProviders(result.value.providers);
      else if (!isAtomCommandInterrupted(result)) setError("Could not list model providers.");
    });
    return () => {
      cancelled = true;
    };
  }, [listProviders, environmentId, instanceId]);

  const flowUrl = state?.authorizationUrl ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens the sign-in page, an effect outside React, once per flow
  useEffect(() => {
    if (!state || state.flowId === null || state.flowId !== startedFlowId) return;
    if (flowUrl === null || !active || openedFlowIdRef.current === state.flowId) return;
    if (state.kind !== "oauth" && state.kind !== "device_code") return;
    openedFlowIdRef.current = state.flowId;
    void tryOpenExternalUrl(flowUrl, "provider-auth");
  }, [state, startedFlowId, flowUrl, active]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the server's provider status and models change when this client's sign-in succeeds
  useEffect(() => {
    if (!succeeded || state?.flowId == null || refreshedFlowIdRef.current === state.flowId) return;
    refreshedFlowIdRef.current = state.flowId;
    refreshAfterSignIn();
  }, [succeeded, state?.flowId]);

  function signIn(provider: OmpLoginProvider) {
    setNote(null);
    void startLogin({ environmentId, input: { instanceId, providerId: provider.providerId } }).then(
      (result) => {
        if (result._tag === "Success") setStartedFlowId(result.value.flowId);
        else if (!isAtomCommandInterrupted(result))
          setError(`Could not sign in to ${provider.name}.`);
      },
    );
  }

  function signOut(provider: OmpLoginProvider) {
    void run(async () => {
      const signedInWays = loginWays(provider, providers ?? []).filter((way) => way.authenticated);
      let remainingSource: string | undefined;
      let last: Awaited<ReturnType<typeof signOutLogin>> | undefined;
      for (const way of signedInWays.length > 0 ? signedInWays : [provider]) {
        last = await signOutLogin({
          environmentId,
          input: { instanceId, providerId: way.providerId },
        });
        if (last._tag !== "Success") return last;
        remainingSource ??= last.value.remainingSource;
      }
      setNote(
        remainingSource === undefined
          ? null
          : `${provider.name} is still signed in via ${remainingSource}.`,
      );
      void refreshProviders(target);
      void loadProviders();
      return last!;
    });
  }

  function submitPrompt(flow: OmpLoginState) {
    if (flow.flowId === null || flow.prompt === null || !canSubmitPrompt(flow.prompt, draftValue)) {
      return;
    }
    const flowId = flow.flowId;
    const promptId = flow.prompt.id;
    void run(() =>
      respondLogin({
        environmentId,
        input: { instanceId, flowId, promptId, value: draftValue },
      }),
    ).then((sent) => {
      if (sent) setDraft({ id: "", value: "" });
    });
  }

  const { visible, hiddenCount } = visibleLoginProviders(providers ?? [], query, showAll);
  const signedIn = signedInServices(providers ?? []);

  return (
    <View className={props.divider ? "border-t border-border-subtle" : undefined}>
      <View className="gap-0.5 px-4 py-3">
        <Text textRole="body" className="text-foreground">
          {`${props.provider.displayName ?? "Oh My Pi"} model providers`}
        </Text>
        <Text textRole="footnote" className="text-foreground-muted">
          {props.provider.auth.status === "authenticated"
            ? "Signed in"
            : "Sign in to a model provider to use its models"}
        </Text>
      </View>

      {active && state ? (
        <View className="gap-2 px-4 pb-3">
          <Text accessibilityLiveRegion="polite" className="text-foreground">
            {`Signing in to ${flowProviderName}`}
          </Text>
          {step === "device_code" && state.userCode !== null ? (
            <Text selectable className="font-mono text-3xl text-foreground">
              {state.userCode}
            </Text>
          ) : null}
          {step === "device_code" ? (
            <ControlPill
              variant="pill"
              icon="doc.on.doc"
              label="Copy code"
              onPress={() => copyTextWithHaptic(state.userCode ?? "", { target: "device code" })}
            />
          ) : null}
          {flowUrl !== null ? (
            <ListActionRow
              icon="globe"
              label={step === "api_key" ? "Open the provider dashboard" : "Open sign-in page"}
              onPress={() => void tryOpenExternalUrl(flowUrl, "provider-auth")}
            />
          ) : null}
          {step === "oauth" ? (
            <Text className="text-foreground-muted">Waiting for you to finish in the browser…</Text>
          ) : step === "device_code" ? (
            <Text className="text-foreground-muted">
              Approve it on the provider's page. Sign-in finishes on its own.
            </Text>
          ) : null}
          {prompt !== null ? (
            <>
              <Text className="text-foreground">
                {step === "oauth"
                  ? "Signed in on another machine or the page cannot reach localhost? Paste the address your browser ended on."
                  : prompt.message}
              </Text>
              <TextInput
                accessibilityLabel={prompt.message}
                className="rounded-lg border border-border-subtle px-3 py-2 text-base text-foreground"
                placeholderTextColorClassName="accent-foreground-muted"
                placeholder="Paste here"
                secureTextEntry={prompt.secret}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={16_384}
                value={draftValue}
                onChangeText={(value) => setDraft({ id: draftId, value })}
                onSubmitEditing={() => submitPrompt(state)}
              />
              <ListActionRow
                icon="arrow.right"
                label="Continue"
                disabled={pending || !canSubmitPrompt(prompt, draftValue)}
                onPress={() => submitPrompt(state)}
              />
            </>
          ) : null}
          <ListActionRow
            icon="xmark"
            label="Cancel sign-in"
            disabled={state.flowId === null}
            onPress={() => {
              if (state.flowId === null) return;
              const flowId = state.flowId;
              void run(() => cancelLogin({ environmentId, input: { instanceId, flowId } }));
            }}
          />
        </View>
      ) : (
        <View className="gap-2 px-4 pb-3">
          {succeeded ? (
            <Text accessibilityLiveRegion="polite" className="text-foreground">
              {`Signed in to ${flowProviderName}.`}
            </Text>
          ) : null}
          {failed !== null ? (
            <Text accessibilityRole="alert" className="text-danger-foreground">
              {`Could not sign in to ${flowProviderName}. ${failed.message ?? ""}`}
            </Text>
          ) : null}
          {signedIn.map((entry) => (
            <ListActionRow
              key={`out:${entry.providerId}`}
              icon="minus"
              label={`Sign out of ${entry.name}`}
              disabled={pending}
              onPress={() => signOut(entry)}
            />
          ))}
          {note !== null ? <Text className="text-foreground-muted">{note}</Text> : null}
          <TextInput
            accessibilityLabel="Search model providers"
            className="rounded-lg border border-border-subtle px-3 py-2 text-base text-foreground"
            placeholderTextColorClassName="accent-foreground-muted"
            placeholder="Search all providers"
            autoCapitalize="none"
            autoCorrect={false}
            value={query}
            onChangeText={setQuery}
          />
          {visible.map((entry) => (
            <ListActionRow
              key={entry.providerId}
              icon="person.crop.circle"
              label={entry.name}
              description={
                isServiceSignedIn(entry, providers ?? [])
                  ? "Signed in. Sign in again to switch account."
                  : undefined
              }
              disabled={pending}
              onPress={() => signIn(preferredLoginProvider(entry, providers ?? []))}
            />
          ))}
          {hiddenCount > 0 ? (
            <ControlPill
              variant="pill"
              label={`Show ${hiddenCount} more providers`}
              onPress={() => setShowAll(true)}
            />
          ) : null}
        </View>
      )}
      {error ? (
        <Text accessibilityRole="alert" className="px-4 pb-3 text-danger-foreground">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
