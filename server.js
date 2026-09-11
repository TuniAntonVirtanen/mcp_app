import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const app = express();
app.set("trust proxy", 1);

// Enable CORS for all incoming ChatGPT origins
app.use(cors({
  origin: "*",
  exposedHeaders: ["WWW-Authenticate", "Mcp-Session-Id"]
}));

// Apply JSON body parser ONLY to routes that need it, 
// leaving /mcp raw for StreamableHTTPServerTransport!
const jsonParser = express.json();
const urlEncodedParser = express.urlencoded({ extended: true });

const AUTH_SERVER_URL = "https://customer-backend-stqk.onrender.com";
const EXPECTED_TOKEN = "mock_access_token_9999";

const getHostUrl = (req) => `${req.protocol}://${req.get("host")}`;

// ---------------------------------------------------------------------------
// 1. OAUTH DISCOVERY ENDPOINTS
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
// 2. MCP ROUTE (Raw Stream Handling - No body-parser middleware here)
// ---------------------------------------------------------------------------

app.post("/mcp", async (req, res) => {
  const authHeader = req.headers.authorization;
  const host = getHostUrl(req);

  // Auth Verification
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

  // Create MCP Instance per request or session
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
          text: `🎉 Successfully retrieved Customer Data for user "user"! Active Sprint: 12 completed tasks, 3 in progress.`
        }
      ]
    })
  );

  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });
    
    await server.connect(transport);
    // Pass raw req/res directly into transport handler
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error("MCP Transport Error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal MCP Transport Error" });
    }
  }
});

// ---------------------------------------------------------------------------
// 3. BACKWARD COMPATIBILITY / INITIALIZE PROBE
// ---------------------------------------------------------------------------

app.post("/", jsonParser, (req, res) => {
  const reqId = req.body?.id || 1;
  if (req.body?.method === "initialize") {
    return res.json({
      jsonrpc: "2.0",
      id: reqId,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "customer-mcp-middleman", version: "1.0.0" }
      }
    });
  }
  res.json({ jsonrpc: "2.0", id: reqId, error: { code: -32600, message: "Invalid Request" } });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`MCP App listening on port ${port}`));