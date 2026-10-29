import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";

import { Dialog, DialogHeader, DialogPopup, DialogPanel, DialogTitle } from "../ui/dialog";
import { OmpModelLoginSection } from "./OmpModelLoginSection";

/** The model-provider sign-in panel in a dialog, for places outside Settings that need it. */
export function OmpModelLoginDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Sign in to a model provider</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <OmpModelLoginSection
            environmentId={props.environmentId}
            instanceId={props.instanceId}
            readOnly={false}
          />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
