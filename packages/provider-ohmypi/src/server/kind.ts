import { defaultInstanceIdForDriver, ProviderDriverKind } from "@t3tools/contracts";

export const OHMYPI_DRIVER_KIND = ProviderDriverKind.make("ohmypi");
export const OHMYPI_DEFAULT_INSTANCE_ID = defaultInstanceIdForDriver(OHMYPI_DRIVER_KIND);
