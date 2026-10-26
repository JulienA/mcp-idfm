import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  isOriginAllowed,
  LookupUnavailableError,
  SnapshotUnavailableError,
  type Application,
  type Config,
} from "./application/index.js";
import { silentLogger, type Logger } from "./infra/logger.js";

function pathname(req: IncomingMessage): string {
  return new URL(req.url ?? "/", "http://localhost").pathname;
}

function originHeader(req: IncomingMessage): string | undefined {
  const value = req.headers.origin;
  return Array.isArray(value) ? value[0] : value;
}

function toolSummary(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object" || !("status" in result)) {
    return {};
  }
  const value = result as {
    status: unknown;
    fiche?: unknown;
    fiches?: unknown[];
    candidates?: unknown[];
    messages?: unknown[];
    groups?: unknown[];
    stale?: unknown;
    summary?: unknown;
  };
  return {
    status: value.status,
    ...(value.fiche ? { matches: 1 } : {}),
    ...(value.fiches ? { matches: value.fiches.length } : {}),
    ...(value.candidates ? { candidates: value.candidates.length } : {}),
    ...(value.messages ? { messages: value.messages.length } : {}),
    ...(value.groups ? { groups: value.groups.length } : {}),
    ...(value.stale !== undefined ? { stale: value.stale } : {}),
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
  };
}

async function toolResult(
  run: () => Promise<unknown>,
  log: Logger,
  tool: string,
  args: Record<string, unknown>,
): Promise<{ content: { type: "text"; text: string }[]; isError?: true }> {
  const started = Date.now();
  try {
    const result = await run();
    const ms = Date.now() - started;
    if (
      result &&
      typeof result === "object" &&
      "status" in result &&
      (result as { status: unknown }).status === "error"
    ) {
      const message =
        "message" in result && typeof result.message === "string"
          ? result.message
          : "Erreur";
      log.warn({ tool, ...args, message, ms }, "MCP tool error");
      return {
        isError: true,
        content: [{ type: "text", text: message }],
      };
    }
    log.info({ tool, ...args, ...toolSummary(result), ms }, "MCP tool");
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  } catch (error) {
    const ms = Date.now() - started;
    if (
      error instanceof SnapshotUnavailableError ||
      error instanceof LookupUnavailableError
    ) {
      log.warn({ tool, ...args, err: error, ms }, "MCP tool failed");
      return {
        isError: true,
        content: [{ type: "text", text: error.message }],
      };
    }
    log.error({ tool, ...args, err: error, ms }, "MCP tool crashed");
    throw error;
  }
}

function registerTools(
  mcpServer: McpServer,
  app: Application,
  log: Logger,
): void {
  mcpServer.registerTool(
    "get_line_id",
    {
      description:
        "Résout une Ligne à partir d'un nom ou d'un identifiant (texte, code Cxxxxx, identifiant Navitia ou référence SIRI).",
      inputSchema: fromJsonSchema<{ query: string }>({
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Nom ou identifiant de la Ligne",
          },
        },
        required: ["query"],
      }),
    },
    async ({ query }) =>
      toolResult(() => app.getLineId(query), log, "get_line_id", { query }),
  );

  mcpServer.registerTool(
    "get_stop_id",
    {
      description:
        "Résout une Zone d'arrêt à partir d'un nom ou d'un identifiant (texte, identifiant Navitia ou MonitoringRef SIRI).",
      inputSchema: fromJsonSchema<{ query: string }>({
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Nom ou identifiant de la Zone d'arrêt",
          },
        },
        required: ["query"],
      }),
    },
    async ({ query }) =>
      toolResult(() => app.getStopId(query), log, "get_stop_id", { query }),
  );

  mcpServer.registerTool(
    "get_info_trafic",
    {
      description:
        "Retourne l'Info Trafic d'une Ligne à partir d'un nom ou d'un identifiant. Une Ligne est obligatoire.",
      inputSchema: fromJsonSchema<{ query: string }>({
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Nom ou identifiant de la Ligne",
          },
        },
        required: ["query"],
      }),
    },
    async ({ query }) =>
      toolResult(() => app.getInfoTrafic(query), log, "get_info_trafic", {
        query,
      }),
  );

  mcpServer.registerTool(
    "prochain_passage",
    {
      description:
        "Retourne les Prochains Passages en temps réel d'une Zone d'arrêt, éventuellement filtrés par Ligne.",
      inputSchema: fromJsonSchema<{ query: string; ligne?: string }>({
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Nom ou identifiant de la Zone d'arrêt",
          },
          ligne: {
            type: "string",
            description:
              "Nom ou identifiant optionnel de la Ligne pour filtrer les passages",
          },
        },
        required: ["query"],
      }),
    },
    async ({ query, ligne }) =>
      toolResult(() => app.prochainPassage(query, ligne), log, "prochain_passage", {
        query,
        ...(ligne ? { ligne } : {}),
      }),
  );
}

async function handleMcp(
  app: Application,
  log: Logger,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const mcpServer = new McpServer({ name: "mcp-idfm", version: "0.1.0" });
  registerTools(mcpServer, app, log);
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res);
}

async function handleRequest(
  config: Config,
  app: Application,
  log: Logger,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const path = pathname(req);
    if (req.method === "GET" && path === "/health") {
      const health = app.getHealth();
      log.debug({ ...health }, "health");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(health));
      return;
    }
    if (req.method === "POST" && path === "/mcp") {
      if (!isOriginAllowed(originHeader(req), config)) {
        log.warn(
          { origin: originHeader(req), host: config.host, port: config.port },
          "Origin rejected",
        );
        res.writeHead(403);
        res.end();
        return;
      }
      await handleMcp(app, log, req, res);
      return;
    }
    log.warn({ method: req.method, path }, "HTTP not found");
    res.writeHead(404);
    res.end();
  } catch (error) {
    log.error({ err: error }, "HTTP request failed");
    if (!res.headersSent) {
      res.writeHead(500);
    }
    res.end();
  }
}

export async function startHttpServer(
  config: Config,
  app: Application,
  log: Logger = silentLogger,
): Promise<Server> {
  const server = createServer((req, res) => {
    void handleRequest(config, app, log, req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(config.port, config.bindAddress, () => {
      log.info(
        {
          bindAddress: config.bindAddress,
          host: config.host,
          port: config.port,
        },
        "MCP listening",
      );
      resolve();
    });
    server.once("error", reject);
  });

  return server;
}
