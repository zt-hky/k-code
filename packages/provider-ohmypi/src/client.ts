import { ProviderDriverKind } from "@t3tools/contracts";
import { defineProviderClient } from "@t3tools/provider-core/client";

import { OhMyPiSettings } from "./settings.ts";

export const ohMyPiClient = defineProviderClient({
  driverKind: ProviderDriverKind.make("ohmypi"),
  label: "Oh My Pi",
  acpRegistryAgentIds: ["omp"],
  settingsSchema: OhMyPiSettings,
  icon: {
    viewBox: "0 0 24 24",
    fill: { light: "#0F0F0F", dark: "#F5F5F5" },
    paths: [
      { d: "M3 5h18v2.5H3z" },
      { d: "M7 7.5h2.5V19H7z" },
      { d: "M14.5 7.5H17v8.1c0 .9.4 1.4 1.3 1.4H20V19h-1.9c-2.2 0-3.6-1.3-3.6-3.5z" },
    ],
  },
});
