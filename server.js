// MCP Server setup (In your MCP Server file)
import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const app = express();
app.set("trust proxy", 1);

app.use(cors({
  origin: "*",
  exposedHeaders: ["WWW-Authenticate", "Mcp-Session-Id"]
}));

const AUTH_SERVER_URL = "https://customer-backend-stqk.onrender.com";
const EXPECTED_TOKEN = "mock_access_token_9999";

const getHostUrl = (req) => `${req.protocol}://${req.get("host")}`;

// Helper to instantiate server with tools
function createMcpServer() {
  const server = new McpServer({
    name: "customer-mcp-middleman",
    version: "1.0.0"
  });

  server.tool(
    "get_customer_projects",
    "Fetches project metrics from the authenticated Customer account.",
    {},
    async () => {
      console.log(`[MCP TOOL EXECUTED] "get_customer_projects" invoked`);
      return {
        content: [
          {
            type: "text",
            text: `🎉 Successfully retrieved Customer Data for user "user"! Active Sprint: 12 completed tasks, 3 in progress.`
          }
        ]
      };
    }
  );
  return server;
}

// Global transport instance for stream handling
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => "single-session"
});

// Connect transport once
const mcpServer = createMcpServer();
await mcpServer.connect(transport);

// ---------------------------------------------------------------------------
// DISCOVERY ENDPOINTS
// ---------------------------------------------------------------------------

app.get("/.well-known/oauth-protected-resource", (req, res) => {
  const host = getHostUrl(req);
  res.json({
    resource: `${host}/mcp`,
    authorization_servers: [AUTH_SERVER_URL],
    scopes_supported: ["read", "write"],
    bearer_methods_supported: ["header"]
  });
});

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  res.json({
    issuer: AUTH_SERVER_URL,
    authorization_endpoint: `${AUTH_SERVER_URL}/oauth/authorize`,
    token_endpoint: `${AUTH_SERVER_URL}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: ["read", "write"]
  });
});

// ---------------------------------------------------------------------------
// MCP STREAM ENDPOINT
// ---------------------------------------------------------------------------

app.post("/mcp", async (req, res) => {
  console.log(`[MCP REQ] POST /mcp received`);
  const authHeader = req.headers.authorization;
  const host = getHostUrl(req);

  // 1. Return JSON-RPC-friendly 401 response if no token provided
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.warn(`[MCP API 401] Bearer token missing.`);
    res.set(
      "WWW-Authenticate",
      `Bearer realm="mcp", resource_metadata="${host}/.well-known/oauth-protected-resource"`
    );
    return res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized: Missing Bearer Token" },
      id: null
    });
  }

  // 2. Token validation
  const token = authHeader.split(" ")[1];
  if (token !== EXPECTED_TOKEN) {
    console.warn(`[MCP API 403] Invalid Token: ${token}`);
    return res.status(403).json({ error: "invalid_token" });
  }

  // 3. Delegate execution safely to MCP transport
  try {
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error("[MCP TRANSPORT ERROR]", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "mcp_transport_failed" });
    }
  }
});

app.get("/mcp", async (req, res) => {
  res.status(405).json({ error: "method_not_allowed" });
});

app.delete("/mcp", async (req, res) => {
  res.status(200).end();
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`MCP App listening on port ${port}`));