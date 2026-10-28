import { RepeatIcon } from "lucide-react";
import { memo } from "react";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { ComposerControl, ComposerControlIcon, type ComposerControlSize } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { loopControlLabel, type LoopState } from "./loopMode.logic";
import { useLoopModeStore } from "./loopModeStore";
import { useComposerMenuState } from "./useComposerMenuState";

/** Off, a run count, or until stopped, as the radio value. */
function loopChoiceValue(loop: LoopState | null) {
  if (loop === null) return "off";
  return loop.remaining === null ? "unlimited" : String(loop.iteration + loop.remaining);
}

export function ComposerLoopOptions(props: { threadKey: string; onChosen?: () => void }) {
  const { threadKey, onChosen } = props;
  const loop = useLoopModeStore((state) => state.loops[threadKey] ?? null);
  return (
    <MenuRadioGroup
      value={loopChoiceValue(loop)}
      onValueChange={(value) => {
        const { arm, disarm } = useLoopModeStore.getState();
        if (value === "off") disarm(threadKey);
        else arm(threadKey, value === "unlimited" ? null : Number(value));
        onChosen?.();
      }}
    >
      <MenuRadioItem value="off">Off</MenuRadioItem>
      <MenuRadioItem value="3">3 times</MenuRadioItem>
      <MenuRadioItem value="5">5 times</MenuRadioItem>
      <MenuRadioItem value="10">10 times</MenuRadioItem>
      <MenuRadioItem value="unlimited">Until stopped</MenuRadioItem>
    </MenuRadioGroup>
  );
}

export const ComposerLoopControl = memo(function ComposerLoopControl(props: {
  threadKey: string;
  size?: ComposerControlSize;
  hidden?: boolean;
}) {
  const size = props.size ?? "sm";
  const composerFloatingLayerProps = useComposerMenuProps();
  const [open, setOpen] = useComposerMenuState(props.hidden);
  const loop = useLoopModeStore((state) => state.loops[props.threadKey] ?? null);
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <ComposerControl
            size={size}
            className="shrink-0 whitespace-nowrap"
            aria-pressed={loop !== null}
          />
        }
      >
        <ComposerControlIcon icon={RepeatIcon} size={size} />
        <span data-composer-control-label className="sr-only sm:not-sr-only">
          {loop === null ? "Loop" : loopControlLabel(loop)}
        </span>
      </MenuTrigger>
      <MenuPopup align="start" {...composerFloatingLayerProps}>
        <ComposerLoopOptions threadKey={props.threadKey} onChosen={() => setOpen(false)} />
      </MenuPopup>
    </Menu>
  );
});
