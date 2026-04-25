import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerUnhandledRejectionHandler: vi.fn(),
  startGatewayBonjourAdvertiser: vi.fn(async () => ({ stop: vi.fn() })),
}));

vi.mock("openclaw/plugin-sdk/runtime-env", () => ({
  registerUnhandledRejectionHandler: mocks.registerUnhandledRejectionHandler,
}));

vi.mock("./src/advertiser.js", () => ({
  startGatewayBonjourAdvertiser: mocks.startGatewayBonjourAdvertiser,
}));

import plugin from "./index.js";

describe("bonjour plugin", () => {
  it("passes the runtime unhandled-rejection handler into the ciao advertiser", async () => {
    const services: Array<{
      advertise: (ctx: {
        machineDisplayName: string;
        gatewayPort: number;
        gatewayTlsEnabled: boolean;
        canvasPort?: number;
        minimal: boolean;
      }) => Promise<{ stop: () => Promise<void> }>;
    }> = [];
    const api = {
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
      },
      registerGatewayDiscoveryService: vi.fn((service) => {
        services.push(service);
      }),
    };

    plugin.register(api as never);
    await services[0]?.advertise({
      machineDisplayName: "TabiAgent",
      gatewayPort: 18789,
      gatewayTlsEnabled: false,
      canvasPort: 18789,
      minimal: true,
    });

    expect(mocks.startGatewayBonjourAdvertiser).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceName: "TabiAgent (OpenClaw)",
        gatewayPort: 18789,
        gatewayTlsEnabled: false,
        canvasPort: 18789,
        minimal: true,
      }),
      {
        logger: api.logger,
        registerUnhandledRejectionHandler: mocks.registerUnhandledRejectionHandler,
      },
    );
  });
});
