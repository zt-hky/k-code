import type { EnvironmentId, OmpLoginProvider, ProviderInstanceId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { reportAcpFailure } from "../../hooks/useAcpNativeSessions";
import { useEnvironment } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { importedProviderNames } from "./OmpModelLoginSection.logic";

type Step =
  | { readonly kind: "idle" }
  | { readonly kind: "reading" }
  | { readonly kind: "message"; readonly text: string }
  | { readonly kind: "review"; readonly providerIds: ReadonlyArray<string> }
  | { readonly kind: "copying" };

/**
 * Desktop app only. A remote environment cannot see this computer's Oh My Pi sign-ins, so the
 * user may copy them over the environment connection they already have, after reading what leaves
 * this computer. The export lives in a ref for the length of the review and is dropped after.
 */
export function OmpLocalSignIns(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly providers: ReadonlyArray<OmpLoginProvider>;
  readonly disabled: boolean;
  readonly onImported: () => void;
}) {
  const { environmentId, instanceId } = props;
  const environment = useEnvironment(environmentId);
  const label = environment?.label ?? "this environment";
  const importCredentials = useAtomCommand(serverEnvironment.importOmpLoginCredentials, {
    reportFailure: false,
  });
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const exportRef = useRef<string | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drops the exported credentials if the panel goes away mid-review
  useEffect(
    () => () => {
      exportRef.current = null;
    },
    [],
  );

  const forget = () => {
    exportRef.current = null;
    setStep({ kind: "idle" });
  };

  const review = async () => {
    const bridge = window.desktopBridge;
    if (bridge === undefined || step.kind === "reading") return;
    setStep({ kind: "reading" });
    try {
      const result = await bridge.readLocalOmpCredentials();
      switch (result.status) {
        case "ok":
          exportRef.current = result.payload;
          setStep({ kind: "review", providerIds: result.providerIds });
          return;
        case "not_installed":
          setStep({
            kind: "message",
            text: "Oh My Pi is not installed on this computer, so there are no sign-ins to copy. Install it and sign in here first, or sign in on the environment instead.",
          });
          return;
        case "empty":
          setStep({
            kind: "message",
            text: "This computer's Oh My Pi is not signed in to anything yet.",
          });
          return;
        case "failed":
          setStep({ kind: "message", text: result.message });
          return;
      }
    } catch {
      setStep({ kind: "message", text: "Could not read this computer's Oh My Pi sign-ins." });
    }
  };

  const copy = async () => {
    const credentials = exportRef.current;
    if (credentials === null || step.kind !== "review") return;
    setStep({ kind: "copying" });
    const result = await importCredentials({
      environmentId,
      input: { instanceId, credentials },
    });
    forget();
    if (result._tag !== "Success") {
      reportAcpFailure(`Could not copy sign-ins to ${label}`, result);
      return;
    }
    toastManager.add({
      type: "success",
      title:
        result.value.imported === 0
          ? "Nothing new to copy"
          : `Copied ${result.value.imported} sign-in${result.value.imported === 1 ? "" : "s"} to ${label}`,
    });
    props.onImported();
  };

  return (
    <div className="grid gap-2 border-t border-border/60 pt-3 text-xs">
      <div>
        <p className="font-medium text-foreground">Use my local sign-ins</p>
        <p className="text-muted-foreground">
          Copy the model providers this computer's Oh My Pi is signed in to onto {label}, instead of
          signing in again there.
        </p>
      </div>

      {step.kind === "review" || step.kind === "copying" ? (
        <div
          role="alert"
          className="grid gap-2 rounded-md border border-warning/32 bg-warning-surface p-3"
        >
          <p className="font-medium text-foreground">
            Copy {step.kind === "review" ? step.providerIds.length : "these"} sign-in
            {step.kind === "review" && step.providerIds.length === 1 ? "" : "s"} to {label}?
          </p>
          {step.kind === "review" ? (
            <ul className="list-disc pl-4 text-foreground">
              {importedProviderNames(step.providerIds, props.providers).map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-muted-foreground">
            This copies your API keys and sign-in tokens to {label}. Anyone who can use that
            environment can use these accounts. Only copy them to a server you control. They stay on
            this computer too, and T3 Code does not keep a copy.
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="xs"
              disabled={props.disabled || step.kind === "copying"}
              onClick={() => void copy()}
            >
              {step.kind === "copying" ? (
                <>
                  <Spinner size="xs" /> Copying
                </>
              ) : (
                `Copy to ${label}`
              )}
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost-muted"
              disabled={step.kind === "copying"}
              onClick={forget}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={props.disabled || step.kind === "reading"}
            onClick={() => void review()}
          >
            {step.kind === "reading" ? (
              <>
                <Spinner size="xs" /> Reading
              </>
            ) : (
              "Use my local sign-ins"
            )}
          </Button>
          {step.kind === "message" ? (
            <p role="status" className="text-muted-foreground">
              {step.text}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
