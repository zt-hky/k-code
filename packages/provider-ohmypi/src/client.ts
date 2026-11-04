import { ProviderDriverKind } from "@t3tools/contracts";
import { defineProviderClient } from "@t3tools/provider-core/client";

import { OhMyPiSettings } from "./settings.ts";

export const ohMyPiClient = defineProviderClient({
  driverKind: ProviderDriverKind.make("ohmypi"),
  label: "Oh My Pi",
  acpRegistryAgentIds: ["omp"],
  settingsSchema: OhMyPiSettings,
  // The π from https://omp.sh/favicon.svg, cropped to the glyph without its dark tile.
  icon: {
    viewBox: "12 16 40 40",
    fill: { light: "#9b4dff", dark: "#9b4dff" },
    paths: [
      {
        d: "M14 16h36v8H40v32h-8V24h-6v22h-8V24h-4z",
        gradient: {
          x1: 14,
          y1: 16,
          x2: 50,
          y2: 56,
          stops: [
            { offset: 0, color: "#ed4abf" },
            { offset: 0.5, color: "#9b4dff" },
            { offset: 1, color: "#5ad8e6" },
          ],
        },
      },
    ],
  },
});
