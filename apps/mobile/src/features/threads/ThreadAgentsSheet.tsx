import { useAtomValue } from "@effect/atom-react";
import {
  deriveWorkflowGroups,
  projectedSubagentsToRuntime,
} from "@t3tools/client-runtime/state/subagentRuntime";
import {
  formatAgentHubTotals,
  type ThreadTurnSubagents,
} from "@t3tools/client-runtime/state/thread-subagents";
import {
  isOrchestrationV2WorkActive,
  type EnvironmentId,
  type OrchestrationV2Subagent,
  type ThreadId,
} from "@t3tools/contracts";
import { deriveSubagentElapsedMs } from "@t3tools/shared/orchestrationTiming";
import { formatDuration } from "@t3tools/shared/orchestrationTimingCopy";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import * as DateTime from "effect/DateTime";
import { Atom } from "effect/reactivity";
import * as Haptics from "expo-haptics";
import { T, useGT, useMessages } from "gt-react-native";
import { useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SheetHeader } from "../../components/ui/SheetHeader";
import { AppText as Text } from "../../components/ui/AppText";
import { environmentThreadDetails } from "../../state/threads";
import { SubagentRow } from "./SubagentRow";
import { useVisibleSecondClock } from "./use-visible-second-clock";
import { SubagentStopButton } from "./SubagentStopButton";
import { ThreadWorkflowGroup } from "./ThreadWorkflowGroup";
import { ScreenContent } from "../../components/ui/ScreenContent";
import {
  resolveBatchHints,
  subagentThreadTarget,
  type SubagentThreadTarget,
} from "./threadAgentsPresentation";
import { useLinkedThreadReach } from "../../state/linkedThread";

import { useOpenThreadInspector } from "./thread-inspector-navigation";
import { useOpenLinkedThreadRead } from "./useOpenLinkedThread";

type AgentsTarget = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

const EMPTY_TURN_SUBAGENTS_ATOM = Atom.make<ThreadTurnSubagents | null>(null).pipe(
  Atom.withLabel("mobile-thread-turn-subagents:empty"),
);

export function useThreadTurnSubagents(target: AgentsTarget | null): ThreadTurnSubagents | null {
  return useAtomValue(
    target === null
      ? EMPTY_TURN_SUBAGENTS_ATOM
      : environmentThreadDetails.turnSubagentsAtom(target),
  );
}

export function ThreadAgentsSheet({ route }: StaticScreenProps<AgentsTarget>) {
  const target = route.params;
  const navigation = useNavigation();
  const openInspector = useOpenThreadInspector();
  const openLinkedRead = useOpenLinkedThreadRead();
  const insets = useSafeAreaInsets();
  const gt = useGT();
  const messages = useMessages();
  const hub = useAtomValue(environmentThreadDetails.agentHubAtom(target));
  const hasLiveAgent = (hub?.live.length ?? 0) > 0;
  const totalsLine = hub === null ? null : formatAgentHubTotals(hub.totals);
  const workflowGroups = useMemo(
    () =>
      new Map(
        deriveWorkflowGroups(
          projectedSubagentsToRuntime(hub === null ? [] : [...hub.live, ...hub.settled]),
          messages,
        ).map((group) => [group.workflow.id, group]),
      ),
    [hub, messages],
  );
  const batchHints = useMemo(
    () => resolveBatchHints(hub === null ? [] : [...hub.live, ...hub.settled]),
    [hub],
  );

  const openChildThread = (child: SubagentThreadTarget, title: string | null = null) => {
    void Haptics.selectionAsync();
    if (child.linked !== undefined) {
      openLinkedRead(child, child.linked, title, { source: target, replace: true });
      return;
    }
    if (
      openInspector(target, {
        type: "thread",
        environmentId: child.environmentId,
        threadId: child.threadId,
      })
    )
      return;
    // Replace this leaf sheet so the child enters the workspace stack expected by Home's Back button.
    navigation.dispatch(
      StackActions.replace("Thread", {
        environmentId: child.environmentId,
        threadId: child.threadId,
      }),
    );
  };

  const renderSubagent = (subagent: OrchestrationV2Subagent) => {
    const group = workflowGroups.get(subagent.id);
    return group === undefined ? (
      <View key={subagent.id} className="border-b border-border">
        <AgentRow
          subagent={subagent}
          environmentId={target.environmentId}
          tickSeconds={hasLiveAgent}
          batchHint={batchHints.get(subagent.id)}
          onOpen={openChildThread}
        />
      </View>
    ) : (
      <ThreadWorkflowGroup
        key={subagent.id}
        environmentId={target.environmentId}
        subagent={subagent}
        group={group}
        onOpen={(threadId) => openChildThread({ environmentId: target.environmentId, threadId })}
      />
    );
  };

  const renderSection = (title: string, agents: ReadonlyArray<OrchestrationV2Subagent>) =>
    agents.length === 0 ? null : (
      <View key={title}>
        <Text className="pb-1 pt-4 text-xs font-t3-medium uppercase text-foreground-muted">
          {title}
        </Text>
        {agents.map(renderSubagent)}
      </View>
    );

  const content = (
    <ScrollView
      nestedScrollEnabled
      className="flex-1"
      // UIKit must inset content beneath the floating translucent iOS header.
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="px-5 pb-6"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
    >
      {hub === null ? (
        <Text className="pt-6 text-center text-sm text-foreground-muted">
          <T>No agents in this thread yet.</T>
        </Text>
      ) : (
        <>
          {totalsLine !== null ? (
            <Text className="pt-3 text-xs text-foreground-muted">{totalsLine}</Text>
          ) : null}
          {renderSection(gt("Running"), hub.live)}
          {renderSection(gt("Finished"), hub.settled)}
        </>
      )}
    </ScrollView>
  );

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <SheetHeader title={gt("Agents")} onClose={() => navigation.goBack()} />
      <ScreenContent>{content}</ScreenContent>
    </View>
  );
}

function AgentRow(props: {
  readonly environmentId: EnvironmentId;
  readonly subagent: OrchestrationV2Subagent;
  readonly tickSeconds: boolean;
  readonly batchHint?: string | undefined;
  readonly onOpen: (child: SubagentThreadTarget, title: string | null) => void;
}) {
  const { subagent } = props;
  const gt = useGT();
  const reach = useLinkedThreadReach(props.environmentId, [subagent]);
  const target = subagentThreadTarget(
    subagent,
    props.environmentId,
    reach.ownConnection,
    reach.isLinked,
  );

  const row = (
    <View className="py-3.5">
      <SubagentRow
        environmentId={props.environmentId}
        subagent={subagent}
        canOpenRemote={target !== null}
        batchHint={props.batchHint}
        elapsed={<AgentElapsed subagent={subagent} tickSeconds={props.tickSeconds} />}
      />
    </View>
  );

  const content =
    target === null ? (
      <View
        accessible
        className="min-w-0 flex-1"
        accessibilityHint={gt("Provider-managed agent. Its work appears in the transcript.")}
      >
        {row}
      </View>
    ) : (
      <Pressable
        accessibilityRole="link"
        accessibilityHint={
          target.linked === undefined
            ? gt("Opens this agent's thread")
            : gt("Opens a read-only view of this agent's thread on {label}", {
                label: target.linked.label,
              })
        }
        onPress={() => props.onOpen(target, subagent.title)}
        className="min-w-0 flex-1 active:opacity-70"
      >
        {row}
      </Pressable>
    );

  return (
    <View className="flex-row items-center">
      {content}
      <SubagentStopButton environmentId={props.environmentId} subagent={subagent} />
    </View>
  );
}

function AgentElapsed(props: {
  readonly subagent: OrchestrationV2Subagent;
  readonly tickSeconds: boolean;
}) {
  const elapsed = useSubagentElapsed(props.subagent, props.tickSeconds);
  return elapsed === null ? null : (
    <Text className="shrink-0 text-xs tabular-nums text-foreground-muted">{elapsed}</Text>
  );
}

function useSubagentElapsed(
  subagent: Pick<OrchestrationV2Subagent, "status" | "startedAt" | "completedAt">,
  tickSeconds: boolean,
): string | null {
  const running = isOrchestrationV2WorkActive(subagent.status);
  const nowMs = useVisibleSecondClock(tickSeconds && running);
  const messages = useMessages();
  const elapsedMs = deriveSubagentElapsedMs(
    {
      status: subagent.status,
      startedAt: subagent.startedAt === null ? null : DateTime.formatIso(subagent.startedAt),
      completedAt: subagent.completedAt === null ? null : DateTime.formatIso(subagent.completedAt),
    },
    nowMs,
  );
  return elapsedMs === null || elapsedMs === 0 ? null : formatDuration(elapsedMs, messages);
}
