import { ClientSettingsPatch } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const decodePatch = Schema.decodeUnknownOption(Schema.fromJsonString(ClientSettingsPatch));

/** Reads a build-time JSON object of client setting defaults; anything unreadable is ignored. */
export function parseClientSettingsDefaults(raw: string | undefined): ClientSettingsPatch {
  const trimmed = raw?.trim();
  if (!trimmed) return {};
  return Option.getOrElse(decodePatch(trimmed), () => ({}));
}

/** Applied only to a browser with no stored client settings; the first write persists them as the user's own. */
export const BUILD_CLIENT_SETTINGS_DEFAULTS = parseClientSettingsDefaults(
  import.meta.env.VITE_CLIENT_SETTINGS_DEFAULTS,
);
