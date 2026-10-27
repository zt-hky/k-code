import type { ScopedProjectRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "~/rpc/atomRegistry";

/**
 * Which project has the resume-session dialog open. The sidebar menu, command palette and
 * new-project toast all close as their command runs, so the app shell renders the dialog once.
 */
export const resumeSessionDialogProjectAtom = Atom.make<ScopedProjectRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("resume-session:dialog-project"),
);

export function openResumeSessionDialog(projectRef: ScopedProjectRef): void {
  appAtomRegistry.set(resumeSessionDialogProjectAtom, projectRef);
}
