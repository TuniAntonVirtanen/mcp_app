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

// Standard MCP Protected Resource Challenge Handler
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

  const fetchCustomerData = async () => {
    const response = await fetch(`${MCP_BACKEND_URL}/api/v1/projects`, {
      headers: { Authorization: authToken }
    });
    if (!response.ok) throw new Error(`MCP Backend status ${response.status}`);
    const result = await response.json();
    return result.data;
  };

  server.tool(
    "get_workspace1",
    "Fetches workspace 1 sprint metrics from the customer account.",
    {},
    async () => {
      try {
        const data = await fetchCustomerData();
        const ws1 = data.workspace1;
        return {
          content: [
            {
              type: "text",
              text: `Active Sprint: ${ws1.completedTasks} completed tasks, ${ws1.inProgressTasks} in progress`
            }
          ]
        };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: err.message }] };
      }
    }
  );

  server.tool(
    "get_workspace2_formatted",
    "Fetches Workspace 2 data formatted as a graphical bar chart.",
    {},
    async () => {
      try {
        const data = await fetchCustomerData();
        const labels = Object.keys(data.workspace2).map(k => `"${k}"`).join(", ");
        const values = Object.values(data.workspace2).join(", ");

        return {
          content: [
            {
              type: "text",
              text: `Data: ${JSON.stringify(data.workspace2)}\n\n` +
                    `CRITICAL VISUALIZATION INSTRUCTION:\n` +
                    `You MUST output a syntactically valid Mermaid.js xychart block:\n\n` +
                    `\`\`\`mermaid\n` +
                    `xychart-beta\n` +
                    `    title "Workspace 2 Metrics"\n` +
                    `    x-axis [${labels}]\n` +
                    `    y-axis "Values" 0 --> 10\n` +
                    `    bar [${values}]\n` +
                    `\`\`\``
            }
          ]
        };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: err.message }] };
      }
    }
  );

  return server;
}

// Protected Resource Metadata (RFC 9207 / MCP Discovery)
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
    console.error("[MCP APP] Error handling protocol request:", err);
    if (!res.headersSent) res.status(500).json({ error: "internal_error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`MCP App running on port ${port}`));