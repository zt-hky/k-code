import { getClientSettings, updateClientSettings, useClientSettings } from "./useSettings";

export function useFullTranscript(): boolean {
  return useClientSettings((settings) => settings.fullTranscript);
}

export function toggleFullTranscript(): void {
  void updateClientSettings({ fullTranscript: !getClientSettings().fullTranscript });
}
