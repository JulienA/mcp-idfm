import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  getHealth,
  isOriginAllowed,
  type Application,
  type Config,
} from "./application/index.js";

function pathname(req: IncomingMessage): string {
  return new URL(req.url ?? "/", "http://localhost").pathname;
}

function originHeader(req: IncomingMessage): string | undefined {
  const value = req.headers.origin;
  return Array.isArray(value) ? value[0] : value;
}

function registerIdentityTools(
  mcpServer: McpServer,
  identity: Application,
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
    async ({ query }) => {
      const result = await identity.getLineId(query);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    },
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
    async ({ query }) => {
      const result = await identity.getStopId(query);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    },
  );
}

async function handleMcp(
  identity: Application,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const mcpServer = new McpServer({ name: "mcp-idfm", version: "0.1.0" });
  registerIdentityTools(mcpServer, identity);
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res);
}

async function handleRequest(
  config: Config,
  identity: Application,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const path = pathname(req);
    if (req.method === "GET" && path === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(getHealth()));
      return;
    }
    if (req.method === "POST" && path === "/mcp") {
      if (!isOriginAllowed(originHeader(req), config)) {
        res.writeHead(403);
        res.end();
        return;
      }
      await handleMcp(identity, req, res);
      return;
    }
    res.writeHead(404);
    res.end();
  } catch {
    if (!res.headersSent) {
      res.writeHead(500);
    }
    res.end();
  }
}

export async function startHttpServer(
  config: Config,
  identity: Application,
): Promise<Server> {
  const server = createServer((req, res) => {
    void handleRequest(config, identity, req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(config.port, config.bindAddress, () => {
      resolve();
    });
    server.once("error", reject);
  });

  return server;
}
