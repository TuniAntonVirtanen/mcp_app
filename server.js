import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const AUTH_SERVER_URL = "https://customer-backend-stqk.onrender.com"; // Your backend
const EXPECTED_TOKEN = "mock_access_token_9999";

// Helper to reliably retrieve the public-facing URL of this MCP server
const getHostUrl = (req) => `${req.protocol}://${req.get("host")}`;

// ---------------------------------------------------------------------------
// OAUTH DISCOVERY METADATA
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

// Dynamic Client Registration Route (Must be top-level)
app.post("/oauth/register", (req, res) => {
  res.json({
    client_id: "chatgpt-mcp-client",
    client_secret: "mock-secret-not-needed-for-pkce",
    redirect_uris: req.body?.redirect_uris || ["https://chatgpt.com/connector/oauth/"]
  });
});

// ---------------------------------------------------------------------------
// MCP AUTHENTICATION MIDDLEWARE
// ---------------------------------------------------------------------------

const mcpAuthGate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const host = getHostUrl(req);

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.set(
      "WWW-Authenticate",
      `Bearer realm="mcp", resource_metadata="${host}/.well-known/oauth-protected-resource"`
    );
    return res.status(401).json({
      error: "unauthorized",
      error_description: "Authentication required to access this MCP server."
    });
  }

  const token = authHeader.split(" ")[1];
  if (token !== EXPECTED_TOKEN) {
    return res.status(403).json({
      error: "invalid_token",
      error_description: "The provided token is invalid or expired."
    });
  }

  req.user = { username: "user", token: token };
  next();
};

// ---------------------------------------------------------------------------
// MCP SERVER INITIALIZATION & ENDPOINTS
// ---------------------------------------------------------------------------

const createMcpServer = (user) => {
  const server = new McpServer({
    name: "customer-mcp-middleman",
    version: "1.0.0"
  });

  server.tool(
    "get_customer_projects",
    "Fetches project metrics from the authenticated Customer account.",
    {},
    async () => ({
      content: [
        {
          type: "text",
          text: `🎉 Retrieved Customer Data for user "${user.username}"! Active Sprint: 12 completed tasks, 3 in progress.`
        }
      ]
    })
  );

  return server;
};

app.post("/mcp", mcpAuthGate, async (req, res) => {
  try {
    const server = createMcpServer(req.user);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP Error:", err);
    res.status(500).json({ error: "Internal MCP Server Error" });
  }
});

// Catch-all route for root JSON-RPC discovery
app.post("/", (req, res) => {
  const reqId = req.body?.id || 1;

  if (req.body?.method === "initialize") {
    return res.json({
      jsonrpc: "2.0",
      id: reqId,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: {
          name: "customer-mcp-middleman",
          version: "1.0.0"
        }
      }
    });
  }

  res.json({
    jsonrpc: "2.0",
    id: reqId,
    error: {
      code: -32600,
      message: "Invalid Request"
    }
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`MCP App listening on port ${port}`);
});