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
  console.log(`[MCP DISCOVERY] /oauth-protected-resource fetched. Host: ${host}`);
  res.json({
    resource: `${host}/mcp`,
    authorization_servers: [AUTH_SERVER_URL],
    scopes_supported: ["read", "write"]
  });
});

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const host = getHostUrl(req);
  console.log(`[MCP DISCOVERY] /oauth-authorization-server fetched. Proxying endpoints for: ${AUTH_SERVER_URL}`);
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

  console.log(`[MCP API] Request to /mcp. Auth header present: ${!!authHeader}`);

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.warn(`[MCP API 401] Missing or malformed Bearer token. Sending WWW-Authenticate header.`);
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
  console.log(`[MCP API] Extracted token: "${token}"`);

  if (token !== EXPECTED_TOKEN) {
    console.warn(`[MCP API 403] Token mismatch. Expected: "${EXPECTED_TOKEN}", Received: "${token}"`);
    return res.status(403).json({ error: "invalid_token" });
  }

  console.log(`[MCP API SUCCESS] Token valid. Passing request to MCP Transport.`);
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