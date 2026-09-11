import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// 1. CONFIGURATION: Point to your deployed Mock Customer server
// ---------------------------------------------------------------------------
const AUTH_SERVER_URL = "https://customer-backend-stqk.onrender.com"; // <-- Update this!
const EXPECTED_TOKEN = "mock_access_token_9999";

// ---------------------------------------------------------------------------
// 2. OAUTH DISCOVERY METADATA (Required by MCP Clients)
// ---------------------------------------------------------------------------

// Protected Resource Metadata (RFC 9728)
app.get("/.well-known/oauth-protected-resource", (req, res) => {
  res.json({
    resource: `http://localhost:${process.env.PORT || 3000}/mcp`,
    authorization_servers: [AUTH_SERVER_URL],
    scopes_supported: ["read", "write"]
  });
});

// Authorization Server Mirror / Discovery (RFC 8414)
app.get("/.well-known/oauth-authorization-server", (req, res) => {
  res.json({
    issuer: AUTH_SERVER_URL,
    authorization_endpoint: `${AUTH_SERVER_URL}/oauth/authorize`,
    token_endpoint: `${AUTH_SERVER_URL}/oauth/token`,
    registration_endpoint: `http://localhost:${process.env.PORT || 3000}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    // ADD THIS FIELD TO SATISFY THE MCP PKCE SECURITY SPEC:
    code_challenge_methods_supported: ["S256"]
  });
});

// ---------------------------------------------------------------------------
// 3. MCP AUTHENTICATION MIDDLEWARE
// ---------------------------------------------------------------------------
const mcpAuthGate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  // If no token or wrong format, send standard MCP OAuth 401 challenge
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.set(
      "WWW-Authenticate",
      `Bearer realm="mcp", resource_metadata="http://localhost:${process.env.PORT || 3000}/.well-known/oauth-protected-resource"`
    );
    return res.status(401).json({
      error: "unauthorized",
      error_description: "Authentication required to access this MCP server."
    });
  }

  const token = authHeader.split(" ")[1];

  // Validate token
  if (token !== EXPECTED_TOKEN) {
    return res.status(403).json({
      error: "invalid_token",
      error_description: "The provided token is invalid or expired."
    });
  }

  // Token is valid!
  req.user = { username: "user", token: token };
  next();
};

// ---------------------------------------------------------------------------
// 4. MCP SERVER CREATION & TOOLS
// ---------------------------------------------------------------------------
const createMcpServer = (user) => {
  const server = new McpServer({
    name: "customer-mcp-middleman",
    version: "1.0.0"
  });

  // Protected tool that depends on authentication
  server.tool(
    "get_customer_projects",
    "Fetches project metrics from the authenticated Customer account.",
    {},
    async () => {
      return {
        content: [
          {
            type: "text",
            text: `🎉 Successfully retrieved Customer Data for user "${user.username}"! Active Sprint: 12 completed tasks, 3 in progress.`
          }
        ]
      };
    }
  );

  return server;
};

// ---------------------------------------------------------------------------
// 5. PROTECTED ROUTE
// ---------------------------------------------------------------------------
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

// LLM's post-auth discovery probe:
// Handles ChatGPT's post-auth JSON-RPC action discovery probe
app.post("/", (req, res) => {
  const reqId = req.body?.id || 1;

  // Check if it's asking for MCP initialization
  if (req.body?.method === "initialize") {
    return res.json({
      jsonrpc: "2.0",
      id: reqId,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "screenful-mcp-middleman",
          version: "1.0.0"
        }
      }
    });
  }

  app.post("/oauth/register", (req, res) => {
  res.json({
    client_id: "chatgpt-mcp-client",
    client_secret: "mock-secret-not-needed-for-pkce",
    redirect_uris: req.body?.redirect_uris || ["https://chatgpt.com/connector/oauth/"]
  });
});

  // For any other probe, send a compliant JSON-RPC response
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
  console.log(`MCP App listening on http://localhost:${port}`);
  console.log(`Configured Auth Provider: ${AUTH_SERVER_URL}`);
});