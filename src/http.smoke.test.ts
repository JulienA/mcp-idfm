import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { boot, createApplication, getHealth } from "./application/index.js";
import { startHttpServer } from "./http.js";

function emptyIdentity() {
  return createApplication({
    lookup: {
      searchLines: async () => [],
      searchStops: async () => [],
    },
  });
}

describe("http adapter", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("accepts POST /mcp", async () => {
    const result = boot({
      PRIM_API_KEY: "test-key",
      HOST: "127.0.0.1",
      PORT: "0",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected boot to succeed");
    }

    const server = await startHttpServer(result.config, emptyIdentity());
    close = () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });

    const address = server.address() as AddressInfo;
    expect(address.address).toBe("0.0.0.0");

    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2026-07-28",
          capabilities: {},
          clientInfo: { name: "smoke", version: "0.0.0" },
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("jsonrpc");
  });

  it("lists get_line_id, get_stop_id and get_info_trafic with French descriptions", async () => {
    const result = boot({
      PRIM_API_KEY: "test-key",
      HOST: "127.0.0.1",
      PORT: "0",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected boot to succeed");
    }

    const server = await startHttpServer(result.config, emptyIdentity());
    close = () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });

    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("get_line_id");
    expect(body).toContain("get_stop_id");
    expect(body).toContain("get_info_trafic");
    expect(body).toContain("Ligne");
    expect(body).toContain("Zone d'arrêt");
    expect(body).toContain("Info Trafic");
  });

  it("rejects POST /mcp when Origin does not match HOST", async () => {
    const result = boot({
      PRIM_API_KEY: "test-key",
      HOST: "mcp.example.test",
      PORT: "0",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected boot to succeed");
    }

    const server = await startHttpServer(result.config, emptyIdentity());
    close = () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });

    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        origin: "http://evil.example",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2026-07-28",
          capabilities: {},
          clientInfo: { name: "smoke", version: "0.0.0" },
        },
      }),
    });

    expect(response.status).toBe(403);
  });

  it("answers GET /health from the application module", async () => {
    const result = boot({
      PRIM_API_KEY: "test-key",
      HOST: "127.0.0.1",
      PORT: "0",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected boot to succeed");
    }

    const server = await startHttpServer(result.config, emptyIdentity());
    close = () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });

    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(getHealth());
  });
});
