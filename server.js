import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const app = express();
app.set("trust proxy", 1);

app.use(
  cors({
    origin: "*",
    exposedHeaders: ["WWW-Authenticate", "Mcp-Session-Id"]
  })
);

// Logger
app.use((req, res, next) => {
  console.log(`[MCP REQ] ${req.method} ${req.url}`);
  next();
});

const AUTH_SERVER_URL = "https://customer-backend-stqk.onrender.com";
const EXPECTED_TOKEN = "mock_access_token_9999";
const getHostUrl = (req) => `${req.protocol}://${req.get("host")}`;

// Create a single persistent MCP server and transport instance
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

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined // stateless mode: no session tracking needed
});
await mcpServer.connect(transport);

// Middleware to validate Auth Header
const validateAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const host = getHostUrl(req);
  console.log("[AUTH CHECK] header received:", authHeader);

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.log("[AUTH CHECK] missing/malformed header -> 401");
    res.set(
      "WWW-Authenticate",
      `Bearer realm="mcp", resource_metadata="${host}/.well-known/oauth-protected-resource"`
    );
    return res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Authentication required." },
      id: null
    });
  }

  const token = authHeader.split(" ")[1];
  console.log("[AUTH CHECK] token:", token, "expected:", EXPECTED_TOKEN, "match:", token === EXPECTED_TOKEN);
  if (token !== EXPECTED_TOKEN) {
    console.log("[AUTH CHECK] token mismatch -> 403");
    return res.status(403).json({ error: "invalid_token" });
  }

  next();
};

// ---------------------------------------------------------------------------
// DISCOVERY ENDPOINTS
// ---------------------------------------------------------------------------
const sendProtectedResourceMetadata = (req, res) => {
  const host = getHostUrl(req);
  res.json({
    resource: `${host}/mcp`,
    authorization_servers: [AUTH_SERVER_URL],
    scopes_supported: ["read", "write"],
    bearer_methods_supported: ["header"]
  });
};

app.get("/.well-known/oauth-protected-resource", sendProtectedResourceMetadata);
app.get("/.well-known/oauth-protected-resource/mcp", sendProtectedResourceMetadata);

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

app.get("/.well-known/openid-configuration", (req, res) => {
  res.redirect("/.well-known/oauth-authorization-server");
});

// ---------------------------------------------------------------------------
// MCP PROTOCOL ROUTE
// ---------------------------------------------------------------------------
// Allow express.json() ONLY on non-MCP routes, or bypass it for transport
app.use("/mcp", express.json(), validateAuth, async (req, res) => {
  console.log("[MCP] Authorization header:", req.headers.authorization);
  try {
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[MCP] handleRequest threw:", err);
    if (!res.headersSent) res.status(500).json({ error: "internal_error" });
  }
});


const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`MCP App listening on port ${port}`));