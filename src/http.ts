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
import type { Logger } from "./infra/logger.js";

const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
  fatal() {},
};

function pathname(req: IncomingMessage): string {
  return new URL(req.url ?? "/", "http://localhost").pathname;
}

function originHeader(req: IncomingMessage): string | undefined {
  const value = req.headers.origin;
  return Array.isArray(value) ? value[0] : value;
}

async function toolResult(
  run: () => Promise<unknown>,
): Promise<{ content: { type: "text"; text: string }[]; isError?: true }> {
  try {
    const result = await run();
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
      return {
        isError: true,
        content: [{ type: "text", text: message }],
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  } catch (error) {
    if (
      error instanceof SnapshotUnavailableError ||
      error instanceof LookupUnavailableError
    ) {
      return {
        isError: true,
        content: [{ type: "text", text: error.message }],
      };
    }
    throw error;
  }
}

function registerTools(mcpServer: McpServer, app: Application): void {
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
    async ({ query }) => toolResult(() => app.getLineId(query)),
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
    async ({ query }) => toolResult(() => app.getStopId(query)),
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
    async ({ query }) => toolResult(() => app.getInfoTrafic(query)),
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
      toolResult(() => app.prochainPassage(query, ligne)),
  );
}

async function handleMcp(
  app: Application,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const mcpServer = new McpServer({ name: "mcp-idfm", version: "0.1.0" });
  registerTools(mcpServer, app);
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
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(app.getHealth()));
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
      await handleMcp(app, req, res);
      return;
    }
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
