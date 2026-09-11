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

const jsonParser = express.json();

const AUTH_SERVER_URL = "https://customer-backend-stqk.onrender.com";
const EXPECTED_TOKEN = "mock_access_token_9999";

const getHostUrl = (req) => `${req.protocol}://${req.get("host")}`;

// 1. Initialize MCP Server globally
const mcpServer = new McpServer({
  name: "customer-mcp-middleman",
  version: "1.0.0"
});

mcpServer.tool(
  "get_customer_projects",
  "Fetches project metrics from the authenticated Customer account.",
  {},
  async () => ({
    content: [
      {
        type: "text",
        text: `🎉 Successfully retrieved Customer Data for user "user"! Active Sprint: 12 completed tasks, 3 in progress.`
      }
    ]
  })
);

// 2. Setup Persistent Transport Handler
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => "single-session"
});

// Connect transport once on startup
await mcpServer.connect(transport);

// ---------------------------------------------------------------------------
// OAUTH DISCOVERY ENDPOINTS
// ---------------------------------------------------------------------------

app.get("/.well-known/oauth-protected-resource", (req, res) => {
  const host = getHostUrl(req);
  res.json({
    resource: `${host}/mcp`,
    authorization_servers: [AUTH_SERVER_URL],
    scopes_supported: ["read", "write"]
  });
});

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const host = getHostUrl(req);
  res.json({
    issuer: AUTH_SERVER_URL,
    authorization_endpoint: `${AUTH_SERVER_URL}/oauth/authorize`,
    token_endpoint: `${AUTH_SERVER_URL}/oauth/token`,
    registration_endpoint: `${host}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"]
  });
});

app.post("/oauth/register", jsonParser, (req, res) => {
  res.json({
    client_id: "chatgpt-mcp-client",
    client_secret: "mock-secret-not-needed-for-pkce",
    redirect_uris: req.body?.redirect_uris || ["https://chatgpt.com/connector/oauth/"]
  });
});

// ---------------------------------------------------------------------------
// MCP ROUTE (Streamable Transport Endpoint)
// ---------------------------------------------------------------------------

app.post("/mcp", async (req, res) => {
  const authHeader = req.headers.authorization;
  const host = getHostUrl(req);

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.set(
      "WWW-Authenticate",
      `Bearer realm="mcp", resource_metadata="${host}/.well-known/oauth-protected-resource"`
    );
    return res.status(401).json({
      error: "unauthorized",
      error_description: "Authentication required."
    });
  }

  const token = authHeader.split(" ")[1];
  if (token !== EXPECTED_TOKEN) {
    return res.status(403).json({ error: "invalid_token" });
  }

  // Handle request using established transport instance
  await transport.handleRequest(req, res);
});

app.get("/mcp", async (req, res) => {
  res.status(405).json({ error: "method_not_allowed" });
});

app.delete("/mcp", async (req, res) => {
  res.status(200).end();
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`MCP App listening on port ${port}`));