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

// Request Logger
app.use((req, res, next) => {
  console.log(`[MCP REQ] ${req.method} ${req.url}`);
  next();
});

const jsonParser = express.json();

const AUTH_SERVER_URL = "https://customer-backend-stqk.onrender.com";
const EXPECTED_TOKEN = "mock_access_token_9999";

const getHostUrl = (req) => `${req.protocol}://${req.get("host")}`;

const mcpServer = new McpServer({
  name: "customer-mcp-middleman",
  version: "1.0.0"
});

mcpServer.tool(
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

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => "single-session"
});

console.log("[MCP SETUP] Connecting transport...");
await mcpServer.connect(transport);
console.log("[MCP SETUP] Transport connected successfully.");

// ---------------------------------------------------------------------------
// OAUTH DISCOVERY ENDPOINTS
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

app.post("/oauth/register", jsonParser, (req, res) => {
  console.log(`[MCP OAUTH REGISTER] Client registration request:`, req.body);
  const responsePayload = {
    client_id: "chatgpt-mcp-client",
    client_secret: "mock-secret-not-needed-for-pkce",
    redirect_uris: req.body?.redirect_uris || ["https://chatgpt.com/connector/oauth/"]
  };
  console.log(`[MCP OAUTH REGISTER] Responding with:`, responsePayload);
  res.json(responsePayload);
});

// ---------------------------------------------------------------------------
// MCP ROUTE (Streamable Transport Endpoint)
// ---------------------------------------------------------------------------

app.post("/mcp", async (req, res) => {
  const authHeader = req.headers.authorization;
  const host = getHostUrl(req);

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.warn("[MCP API 401] Missing Bearer Token");
    res.set(
      "WWW-Authenticate",
      `Bearer realm="mcp", error="invalid_token", resource_metadata="${host}/.well-known/oauth-protected-resource"`
    );
    return res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null
    });
  }

  const token = authHeader.split(" ")[1];
  if (token !== EXPECTED_TOKEN) {
    console.warn(`[MCP API 403] Invalid Token: ${token}`);
    return res.status(403).json({ error: "invalid_token" });
  }

  // Handle request using MCP HTTP Transport
  await transport.handleRequest(req, res);
});

app.get("/mcp", async (req, res) => {
  console.warn(`[MCP API] GET /mcp received (Not Allowed)`);
  res.status(405).json({ error: "method_not_allowed" });
});

app.delete("/mcp", async (req, res) => {
  console.log(`[MCP API] DELETE /mcp session teardown received.`);
  res.status(200).end();
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`MCP App listening on port ${port}`));