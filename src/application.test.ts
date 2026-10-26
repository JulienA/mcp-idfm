import { describe, expect, it } from "vitest";
import { boot, createApplication, isOriginAllowed } from "./application/index.js";

describe("boot", () => {
  it("exits non-zero when PRIM_API_KEY is missing", () => {
    const result = boot({});
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected boot to fail");
    }
    expect(result.exitCode).not.toBe(0);
    expect(result.message).toBe("PRIM_API_KEY is missing");
  });

  it("exits non-zero when PRIM_API_KEY is empty", () => {
    const result = boot({ PRIM_API_KEY: "" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected boot to fail");
    }
    expect(result.exitCode).not.toBe(0);
  });

  it("exits non-zero when PRIM_API_KEY is only whitespace", () => {
    const result = boot({ PRIM_API_KEY: "  \t" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected boot to fail");
    }
    expect(result.exitCode).not.toBe(0);
  });

  it("starts when PRIM_API_KEY is present", () => {
    const result = boot({ PRIM_API_KEY: "test-key" });
    expect(result.ok).toBe(true);
  });

  it("binds 0.0.0.0 when PRIM_API_KEY is present", () => {
    const result = boot({ PRIM_API_KEY: "test-key" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected boot to succeed");
    }
    expect(result.config.bindAddress).toBe("0.0.0.0");
  });

  it("uses HOST from the environment", () => {
    const result = boot({
      PRIM_API_KEY: "test-key",
      HOST: "mcp.example.test",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected boot to succeed");
    }
    expect(result.config.host).toBe("mcp.example.test");
  });

  it("defaults HOST to localhost", () => {
    const result = boot({ PRIM_API_KEY: "test-key" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected boot to succeed");
    }
    expect(result.config.host).toBe("localhost");
  });

  it("uses PORT from the environment", () => {
    const result = boot({ PRIM_API_KEY: "test-key", PORT: "8080" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected boot to succeed");
    }
    expect(result.config.port).toBe(8080);
  });

  it("defaults PORT to 3000", () => {
    const result = boot({ PRIM_API_KEY: "test-key" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected boot to succeed");
    }
    expect(result.config.port).toBe(3000);
  });

  it("defaults MAX_CANDIDATES to 5", () => {
    const result = boot({ PRIM_API_KEY: "test-key" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected boot to succeed");
    }
    expect(result.config.maxCandidates).toBe(5);
  });

  it("uses MAX_CANDIDATES from the environment", () => {
    const result = boot({
      PRIM_API_KEY: "test-key",
      MAX_CANDIDATES: "8",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected boot to succeed");
    }
    expect(result.config.maxCandidates).toBe(8);
  });

  it("exits non-zero when MAX_CANDIDATES is not a positive integer", () => {
    for (const value of ["0", "-1", "1.5", "abc", " ", "9007199254740993"]) {
      const result = boot({ PRIM_API_KEY: "test-key", MAX_CANDIDATES: value });
      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error(`expected boot to fail for ${value}`);
      }
      expect(result.exitCode).not.toBe(0);
      expect(result.message).toBe("MAX_CANDIDATES must be a positive integer");
    }
  });
});

describe("health", () => {
  it("returns ok with an empty Info Trafic snapshot", () => {
    const app = createApplication({
      lookup: {
        searchLines: async () => [],
        searchStops: async () => [],
      },
    });
    expect(app.getHealth()).toEqual({
      ok: true,
      trafic_updated_at: null,
      stale: null,
    });
  });
});

describe("origin", () => {
  it("allows a missing Origin", () => {
    expect(
      isOriginAllowed(undefined, { host: "mcp.example.test", port: 3000 }),
    ).toBe(true);
  });

  it("allows an Origin that matches HOST", () => {
    expect(
      isOriginAllowed("http://mcp.example.test", {
        host: "mcp.example.test",
        port: 3000,
      }),
    ).toBe(true);
  });

  it("allows an Origin that matches HOST and PORT", () => {
    expect(
      isOriginAllowed("https://mcp.example.test:3000", {
        host: "mcp.example.test",
        port: 3000,
      }),
    ).toBe(true);
  });

  it("rejects an Origin that does not match HOST", () => {
    expect(
      isOriginAllowed("http://evil.example", {
        host: "mcp.example.test",
        port: 3000,
      }),
    ).toBe(false);
  });
});
