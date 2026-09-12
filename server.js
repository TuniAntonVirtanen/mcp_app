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

app.use((req, res, next) => {
  console.log(`[MCP APP REQ] ${req.method} ${req.url}`);
  next();
});

const CUSTOMER_BACKEND_URL = process.env.CUSTOMER_BACKEND_URL || "https://customer-backend-stqk.onrender.com";
const MCP_BACKEND_URL = process.env.MCP_BACKEND_URL || "https://prototype-mcp-backend.onrender.com";

const getHostUrl = (req) => `${req.protocol}://${req.get("host")}`;

const validateAuthHeader = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const host = getHostUrl(req);

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
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
  next();
};

function createMcpServer(authToken) {
  const server = new McpServer({
    name: "customer-mcp-app",
    version: "2.0.0"
  });

  // Single tool returning Workspace 1 metrics
  server.tool(
    "get_data",
    "Fetches workspace 1 sprint metrics from the customer account.",
    {},
    async () => {
      try {
        const response = await fetch(`${MCP_BACKEND_URL}/api/v1/projects`, {
          headers: { Authorization: authToken }
        });

        if (!response.ok) {
          throw new Error(`MCP Backend returned status ${response.status}`);
        }

        const result = await response.json();
        const ws1 = result.data.workspace1;

        return {
          content: [
            {
              type: "text",
              text: `Active Sprint: ${ws1.completedTasks} completed tasks, ${ws1.inProgressTasks} in progress`
            }
          ]
        };
      } catch (err) {
        console.error("[MCP APP] Error querying MCP Backend:", err.message);
        return {
          isError: true,
          content: [{ type: "text", text: `Error processing request: ${err.message}` }]
        };
      }
    }
  );

  return server;
}

const sendProtectedResourceMetadata = (req, res) => {
  const host = getHostUrl(req);
  res.json({
    resource: `${host}/mcp`,
    authorization_servers: [CUSTOMER_BACKEND_URL],
    scopes_supported: ["read", "write"],
    bearer_methods_supported: ["header"]
  });
};

app.get("/.well-known/oauth-protected-resource", sendProtectedResourceMetadata);
app.get("/.well-known/oauth-protected-resource/mcp", sendProtectedResourceMetadata);

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  res.json({
    issuer: CUSTOMER_BACKEND_URL,
    authorization_endpoint: `${CUSTOMER_BACKEND_URL}/oauth/authorize`,
    token_endpoint: `${CUSTOMER_BACKEND_URL}/oauth/token`,
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

app.use("/mcp", express.json(), validateAuthHeader, async (req, res) => {
  try {
    const authToken = req.headers.authorization;
    const server = createMcpServer(authToken);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[MCP APP] Error during protocol handling:", err);
    if (!res.headersSent) res.status(500).json({ error: "internal_error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`MCP App running on port ${port}`));