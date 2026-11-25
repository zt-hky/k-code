/**
 * Where the permissions chip shows, which blocks overflow, and which control answers the
 * composer.mode shortcut. Blocks are ordered [mode, loop]; the last block overflows first. The
 * model picker's footer always holds Permissions, so the chip only shows while the mode differs
 * from the default. The rule: composer.mode has one target.
 */
export function resolveComposerControlsOwnership(input: {
  /** Permissions hide while the mode is the default, or while the new-thread strip names it. */
  readonly matchesDefault: boolean;
  /** Loop mode block, always last; it overflows first and its menu always has content. */
  readonly hasLoop?: boolean;
  readonly collapsed: boolean;
  /** How many trailing blocks the width measurement moved into the overflow menu. */
  readonly measuredHiddenBlockCount: number;
}) {
  const accessDisplay = input.matchesDefault
    ? ("hidden" as const)
    : input.collapsed
      ? ("icon" as const)
      : ("label" as const);
  const showModeBlock = accessDisplay !== "hidden";
  const blockIds = [
    ...(showModeBlock ? ["mode" as const] : []),
    ...(input.hasLoop === true ? ["loop" as const] : []),
  ];
  const hiddenBlockCount = Math.min(input.measuredHiddenBlockCount, blockIds.length);
  const hiddenBlockIds = blockIds.slice(blockIds.length - hiddenBlockCount);
  const modeHidden = hiddenBlockIds.includes("mode");
  // An overflowed chip needs a home for Permissions.
  const overflowShowsPermissions = modeHidden;
  return {
    accessDisplay,
    showModeBlock,
    hiddenBlockCount: hiddenBlockIds.length,
    hiddenBlockIds,
    overflowShowsPermissions,
    /** Without a visible chip or an overflow menu holding it, the model picker answers composer.mode. */
    pickerOwnsModeShortcut: !overflowShowsPermissions && (accessDisplay === "hidden" || modeHidden),
  };
}
