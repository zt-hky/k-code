import { AppBar } from "../../components/ui/AppBar";
import type { AppBarAction, AppBarMenu } from "../../components/ui/AppBar.types";
import {
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
} from "../layout/AdaptiveWorkspaceLayout";
import type { ThreadInspectorMode } from "./thread-inspector-navigation";
import { useWorkspaceBackNavigation } from "../layout/workspace/useAndroidWorkspaceNavigation";
import {
  threadTerminalMenu,
  useThreadGitMenuDefinition,
  type ThreadGitControlsProps,
} from "./ThreadGitControls";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

export function ThreadHeader(props: {
  readonly title: string;
  readonly subtitle: string;
  readonly gitControls: ThreadGitControlsProps;
  readonly onReturnToThread?: () => void;
  readonly draft?: boolean;
  readonly hasThreadCwd: boolean;
  readonly inspectorMode: ThreadInspectorMode | null;
  readonly onOpenFilesInspector: () => void;
}) {
  const goBack = useWorkspaceBackNavigation("threads");
  const { toggleAuxiliaryPane, startNewTask } = useAdaptiveWorkspaceLayout();
  const { panes } = useWorkspacePaneState();
  const gitMenu = useThreadGitMenuDefinition(props.gitControls);
  const terminalMenu = threadTerminalMenu(props.gitControls);
  const { fullTranscript, setFullTranscript } = useAppearancePreferences();
  const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;
  const actions: AppBarAction[] = [
    {
      accessibilityLabel: fullTranscript ? "Hide full transcript" : "Show full transcript",
      icon: "doc.text",
      selected: fullTranscript,
      separateBackground: false,
      onPress: () => setFullTranscript(!fullTranscript),
    },
  ];
  if (props.hasThreadCwd) {
    actions.push({
      accessibilityLabel: filesVisible ? "Close files" : "Open files",
      icon: "folder",
      selected: filesVisible,
      disabled: !props.gitControls.canOpenFiles,
      separateBackground: false,
      onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,
    });
  }
  const menus = [gitMenu, terminalMenu].filter((menu): menu is AppBarMenu => menu !== null);

  return (
    <AppBar
      title={props.title}
      subtitle={props.subtitle}
      onBackToList={goBack}
      onCompose={props.draft ? undefined : startNewTask}
      backInSplitView={
        props.onReturnToThread
          ? {
              accessibilityLabel: "Return to chat",
              icon: "chevron.left",
              onPress: props.onReturnToThread,
            }
          : undefined
      }
      actions={actions}
      menus={menus}
      hideBottomBorder
    />
  );
}
