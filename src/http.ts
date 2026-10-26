import { McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { getHealth, isOriginAllowed, type Config } from "./application/index.js";

function pathname(req: IncomingMessage): string {
  return new URL(req.url ?? "/", "http://localhost").pathname;
}

function originHeader(req: IncomingMessage): string | undefined {
  const value = req.headers.origin;
  return Array.isArray(value) ? value[0] : value;
}

async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const mcpServer = new McpServer({ name: "mcp-idfm", version: "0.1.0" });
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res);
}

async function handleRequest(
  config: Config,
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
      await handleMcp(req, res);
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

export async function startHttpServer(config: Config): Promise<Server> {
  const server = createServer((req, res) => {
    void handleRequest(config, req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(config.port, config.bindAddress, () => {
      resolve();
    });
    server.once("error", reject);
  });

  return server;
}
