import { describe, expect, it } from "vitest";

import playwrightConfig from "../../playwright.config";

describe("Playwright E2E service ports", () => {
  it("keeps the backend API separate from the TiDB port", () => {
    const webServers = Array.isArray(playwrightConfig.webServer) ? playwrightConfig.webServer : [];
    const backendServer = webServers[0];

    expect(backendServer?.url).toBe("http://localhost:4001/healthz");
    expect(backendServer?.env?.API_PORT).toBe("4001");
  });
});
