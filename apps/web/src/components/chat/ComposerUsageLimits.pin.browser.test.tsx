import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type UsageLimitsReport,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { render } from "../../../test/render";
import { ComposerBannerStack } from "./ComposerBannerStack";
import { usageLimitsBannerItem } from "./ComposerUsageLimits";
import { isSessionPinCommand } from "./sessionPin";
import { useUsageLimitsPanel } from "./useUsageLimitsPanel";

const environmentId = EnvironmentId.make("env-1");
const instanceId = ProviderInstanceId.make("ohmypi");
const driver = ProviderDriverKind.make("ohmypi");
const checkedAt = "2026-01-01T00:00:00.000Z";
const limits = { checkedAt, windows: [] };

function account(nativeProvider: string, email: string): UsageLimitsReport["accounts"][number] {
  return {
    id: `${nativeProvider}:${email}`,
    driver,
    label: email,
    email,
    nativeProvider,
    nativeAccountId: `${nativeProvider}-id`,
    instanceId,
    limits,
  };
}

const report: UsageLimitsReport = {
  createdAt: checkedAt,
  accounts: [account("anthropic", "a@example.com"), account("openai-codex", "b@example.com")],
  notices: [],
};

it("offers Pin to thread only for the current model's upstream and sends the pin command", async () => {
  const onPin = vi.fn();
  await using screen = await render(
    <ComposerBannerStack
      items={[
        usageLimitsBannerItem("usage", report, environmentId, () => {}, {
          upstream: "anthropic",
          disabled: false,
          onPin,
        }),
      ]}
    />,
  );

  const buttons = screen.getByRole("button", { name: "Pin to thread" });
  await expect.element(buttons).toBeInTheDocument();
  expect(
    [...screen.container.querySelectorAll("button")].filter(
      (button) => button.textContent === "Pin to thread",
    ),
  ).toHaveLength(1);
  await buttons.click();
  expect(onPin).toHaveBeenCalledWith("/session pin a@example.com");
});

it("disables the pin action while the thread is busy", async () => {
  await using screen = await render(
    <ComposerBannerStack
      items={[
        usageLimitsBannerItem("usage", report, environmentId, () => {}, {
          upstream: "anthropic",
          disabled: true,
          onPin: vi.fn(),
        }),
      ]}
    />,
  );
  await expect.element(screen.getByRole("button", { name: "Pin to thread" })).toBeDisabled();
});

it("recognizes only the bare session pin command", () => {
  expect(isSessionPinCommand("/session pin")).toBe(true);
  expect(isSessionPinCommand("  /Session   pin ")).toBe(true);
  expect(isSessionPinCommand("/session pin a@example.com")).toBe(false);
});

const hubProvider = {
  instanceId,
  driver,
  enabled: true,
  installed: true,
  auth: { status: "authenticated" },
  usageLimits: limits,
  usageLimitAccounts: [
    {
      id: "anthropic:a@example.com",
      driver: ProviderDriverKind.make("claudeAgent"),
      nativeProvider: "anthropic",
      email: "a@example.com",
      usageLimits: limits,
    },
  ],
} as unknown as ServerProvider;

function PanelHarness({ model }: { readonly model: string }) {
  const panel = useUsageLimitsPanel({
    environmentId,
    threadKey: "thread",
    panelKey: "key",
    providerInstanceId: instanceId,
    providerDriver: driver,
    providers: [hubProvider],
    sources: [],
    modelSlug: model,
    pinDisabled: false,
    sendPinCommand: () => {},
  });
  return (
    <>
      <button type="button" onClick={() => panel.open({ pinnableOnly: true })}>
        open
      </button>
      <span data-testid="offered">{String(panel.sessionPinOffered)}</span>
      {panel.banner ? <ComposerBannerStack items={[panel.banner]} /> : null}
    </>
  );
}

it("offers bare /session pin when the model's upstream has hub accounts", async () => {
  await using screen = await render(<PanelHarness model="anthropic/claude-sonnet-5-5" />);
  expect(screen.getByTestId("offered").element().textContent).toBe("true");
  await screen.getByRole("button", { name: "open" }).click();
  await expect.element(screen.getByRole("button", { name: "Pin to thread" })).toBeInTheDocument();
});

it("does not offer bare /session pin for an upstream without hub accounts", async () => {
  await using screen = await render(<PanelHarness model="openai-codex/gpt-6-sol" />);
  expect(screen.getByTestId("offered").element().textContent).toBe("false");
});
