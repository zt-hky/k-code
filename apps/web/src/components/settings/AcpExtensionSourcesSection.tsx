import {
  AuthOrchestrationReadScope,
  AuthProvidersManageScope,
  type AcpRegistryExtension,
  type EnvironmentId,
  type ProjectId,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { readEnvironmentScope, useEnvironmentScope } from "~/state/session";
import { reportAcpFailure } from "../../hooks/useAcpNativeSessions";
import { ensureLocalApi } from "../../localApi";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const SOURCE_LEVEL_LABEL = {
  user: "User",
  project: "Project",
  native: "Built-in",
} as const;

interface ExtensionSourceGroup {
  readonly providerId: string;
  readonly sourceName: string;
  readonly levels: ReadonlyArray<AcpRegistryExtension["sourceLevel"]>;
  readonly extensions: ReadonlyArray<AcpRegistryExtension>;
}

function groupExtensionsBySource(
  extensions: ReadonlyArray<AcpRegistryExtension>,
): ReadonlyArray<ExtensionSourceGroup> {
  const byProvider = new Map<string, AcpRegistryExtension[]>();
  for (const extension of extensions) {
    const group = byProvider.get(extension.sourceProvider);
    if (group === undefined) byProvider.set(extension.sourceProvider, [extension]);
    else group.push(extension);
  }
  return [...byProvider.entries()]
    .map(([providerId, items]) => ({
      providerId,
      sourceName: items[0]?.sourceName ?? providerId,
      levels: [...new Set(items.map((item) => item.sourceLevel))],
      extensions: items,
    }))
    .toSorted((left, right) => left.sourceName.localeCompare(right.sourceName));
}

export function AcpExtensionSourcesSection(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly projectId: ProjectId | null;
}) {
  const canRead = useEnvironmentScope(props.environmentId, AuthOrchestrationReadScope);
  const [extensions, setExtensions] = useState<ReadonlyArray<AcpRegistryExtension> | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingProviderId, setSavingProviderId] = useState<string | null>(null);
  const listExtensions = useAtomCommand(serverEnvironment.listAcpRegistryExtensions, {
    reportFailure: false,
  });
  const setExtensionSource = useAtomCommand(serverEnvironment.setAcpRegistryExtensionSource, {
    reportFailure: false,
  });

  const loadExtensions = async () => {
    if (props.projectId === null || loading) return;
    setLoading(true);
    const result = await listExtensions({
      environmentId: props.environmentId,
      input: { instanceId: props.instanceId, projectId: props.projectId },
    });
    setLoading(false);
    if (result._tag === "Success") {
      setExtensions(result.value.extensions);
      return;
    }
    reportAcpFailure("Could not list extensions", result);
  };

  const toggleSource = async (group: ExtensionSourceGroup, enabled: boolean) => {
    if (props.projectId === null || savingProviderId !== null) return;
    if (!readEnvironmentScope(props.environmentId, AuthProvidersManageScope)) {
      toastManager.add({
        type: "error",
        title: "You don't have permission to change extensions",
      });
      return;
    }
    if (!enabled) {
      const activeCount = group.extensions.filter(
        (extension) => extension.state === "active",
      ).length;
      const confirmed = await ensureLocalApi().dialogs.confirm(
        `Stop loading ${activeCount} extensions from ${group.sourceName}? New Oh My Pi sessions start without them.`,
        { variant: "destructive" },
      );
      if (!confirmed) return;
    }
    setSavingProviderId(group.providerId);
    const result = await setExtensionSource({
      environmentId: props.environmentId,
      input: {
        instanceId: props.instanceId,
        projectId: props.projectId,
        providerId: group.providerId,
        enabled,
      },
    });
    setSavingProviderId(null);
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: `Extensions from ${group.sourceName} turned ${enabled ? "on" : "off"}`,
      });
      await loadExtensions();
      return;
    }
    reportAcpFailure("Could not update extensions", result);
  };

  const groups = extensions === null ? [] : groupExtensionsBySource(extensions);

  return (
    <div className="grid gap-3 border-t border-border/60 px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-foreground">Extensions</p>
          <p className="text-xs text-muted-foreground">
            Skills, rules, MCP servers and tools Oh My Pi loads, by where they come from.
          </p>
        </div>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={!canRead || loading || props.projectId === null}
          onClick={() => void loadExtensions()}
        >
          {loading ? "Loading" : extensions === null ? "Show extensions" : "Refresh"}
        </Button>
      </div>

      {groups.length > 0 ? (
        <div className="divide-y divide-border/60 border-y border-border/60">
          {groups.map((group) => (
            <ExtensionSourceRow
              key={group.providerId}
              group={group}
              saving={savingProviderId !== null}
              onToggle={(enabled) => void toggleSource(group, enabled)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ExtensionSourceRow(props: {
  readonly group: ExtensionSourceGroup;
  readonly saving: boolean;
  readonly onToggle: (enabled: boolean) => void;
}) {
  const { group } = props;
  const [open, setOpen] = useState(false);
  const activeCount = group.extensions.filter((extension) => extension.state === "active").length;
  const sourceEnabled = !group.extensions.some(
    (extension) => extension.disabledReason === "provider-disabled",
  );
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-3">
        <CollapsibleTrigger className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
              open && "rotate-90",
            )}
          />
          <span className="truncate text-xs font-medium text-foreground">{group.sourceName}</span>
          {group.levels.map((level) => (
            <Badge key={level} size="sm" variant="outline">
              {SOURCE_LEVEL_LABEL[level]}
            </Badge>
          ))}
          <span className="truncate text-xs text-muted-foreground">
            {activeCount} active · {group.extensions.length - activeCount} off
          </span>
        </CollapsibleTrigger>
        <Switch
          size="sm"
          aria-label={`Load extensions from ${group.sourceName}`}
          checked={sourceEnabled}
          disabled={group.providerId === "native" || props.saving}
          onCheckedChange={(checked) => props.onToggle(checked)}
        />
      </div>
      <CollapsiblePanel>
        <div className="pb-2 pl-6">
          {group.extensions.map((extension) => (
            <div key={extension.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-xs text-foreground">
                {extension.displayName}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Badge size="sm" variant="secondary">
                  {extension.kind}
                </Badge>
                {extension.state === "active" ? null : (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Badge size="sm" variant="warning">
                          {extension.state === "disabled" ? "Off" : "Shadowed"}
                        </Badge>
                      }
                    />
                    {(extension.shadowedBy ?? extension.disabledReason) ? (
                      <TooltipPopup>
                        {extension.shadowedBy
                          ? `Shadowed by ${extension.shadowedBy}`
                          : extension.disabledReason}
                      </TooltipPopup>
                    ) : null}
                  </Tooltip>
                )}
              </span>
            </div>
          ))}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
