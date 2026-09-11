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

app.use(express.json());

// Global request logger
app.use((req, res, next) => {
  console.log(`[MCP REQ] ${req.method} ${req.url}`);
  next();
});

const AUTH_SERVER_URL = "https://customer-backend-stqk.onrender.com";
const EXPECTED_TOKEN = "mock_access_token_9999";

const getHostUrl = (req) => `${req.protocol}://${req.get("host")}`;

// Instantiate MCP Server
const createMcpServer = () => {
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
};

// ---------------------------------------------------------------------------
// OAUTH DISCOVERY ENDPOINTS (RFC 9728 Compliance)
// ---------------------------------------------------------------------------

const sendProtectedResourceMetadata = (req, res) => {
  const host = getHostUrl(req);
  console.log(`[MCP DISCOVERY] Serving protected-resource metadata to: ${req.url}`);
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
  console.log(`[MCP DISCOVERY] Serving authorization-server metadata proxy`);
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
// MCP ROUTE
// ---------------------------------------------------------------------------

app.post(["/", "/mcp"], async (req, res) => {
  const authHeader = req.headers.authorization;
  const host = getHostUrl(req);

  console.log(`[MCP API] POST /mcp - Auth Present: ${!!authHeader}`);

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.warn(`[MCP API 401] No Bearer token. Triggering OAuth metadata challenge.`);
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
  console.log(`[MCP API] Received Token: "${token}"`);

  if (token !== EXPECTED_TOKEN) {
    console.warn(`[MCP API 403] Invalid Token.`);
    return res.status(403).json({ error: "invalid_token" });
  }

  try {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport();
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error(`[MCP TRANSPORT ERROR]`, err);
    if (!res.headersSent) {
      res.status(500).json({ error: "transport_error" });
    }
  }
});

app.get(["/", "/mcp"], async (req, res) => {
  res.status(405).json({ error: "method_not_allowed" });
});

app.delete(["/", "/mcp"], async (req, res) => {
  res.status(200).end();
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`MCP App listening on port ${port}`));