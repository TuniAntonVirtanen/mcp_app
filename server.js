import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const app = express();
app.set("trust proxy", 1);
app.use(cors({ origin: "*", exposedHeaders: ["WWW-Authenticate", "Mcp-Session-Id"] }));
app.use((req, res, next) => { console.log(`[MCP REQ] ${req.method} ${req.url}`); next(); });

const AUTH_SERVER_URL = "https://customer-backend-stqk.onrender.com";
const EXPECTED_TOKEN = "mock_access_token_9999";
const getHostUrl = (req) => `${req.protocol}://${req.get("host")}`;

// 1. validateAuth defined here, BEFORE it's used
const validateAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const host = getHostUrl(req);
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.set("WWW-Authenticate", `Bearer realm="mcp", resource_metadata="${host}/.well-known/oauth-protected-resource"`);
    return res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Authentication required." }, id: null });
  }
  const token = authHeader.split(" ")[1];
  if (token !== EXPECTED_TOKEN) return res.status(403).json({ error: "invalid_token" });
  next();
};

// 2. getServer factory
function getServer() {
  const server = new McpServer({ name: "customer-mcp-middleman", version: "1.0.0" });
  server.tool(
    "get_customer_projects",
    "Fetches project metrics from the authenticated Customer account.",
    {},
    async () => ({ content: [{ type: "text", text: `🎉 Successfully retrieved Customer Data for user "user"! Active Sprint: 12 completed tasks, 3 in progress.` }] })
  );
  return server;
}

// 3. Discovery endpoints (unchanged)
app.get("/.well-known/oauth-protected-resource", sendProtectedResourceMetadata);
app.get("/.well-known/oauth-protected-resource/mcp", sendProtectedResourceMetadata);
app.get("/.well-known/oauth-authorization-server", (req, res) => { /* ...same as before... */ });
app.get("/.well-known/openid-configuration", (req, res) => res.redirect("/.well-known/oauth-authorization-server"));

// 4. The ONLY /mcp route
app.use("/mcp", express.json(), validateAuth, async (req, res) => {
  try {
    const server = getServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[MCP] handleRequest threw:", err);
    if (!res.headersSent) res.status(500).json({ error: "internal_error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`MCP App listening on port ${port}`));


/*
  Deprecated

  // Create a single persistent MCP server and transport instance
const mcpServer = new McpServer({
  name: "customer-mcp-middleman",
  version: "1.0.0"
});

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined // stateless mode: no session tracking needed
});
await mcpServer.connect(transport);

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


// ---------------------------------------------------------------------------
// MCP PROTOCOL ROUTE
// ---------------------------------------------------------------------------
// Allow express.json() ONLY on non-MCP routes, or bypass it for transport
app.use("/mcp", express.json(), validateAuth, async (req, res) => {
  console.log("[MCP] Authorization header:", req.headers.authorization);
  console.log("[MCP] Accept header:", req.headers.accept);
  console.log("[MCP] Body:", JSON.stringify(req.body));
  try {
    await transport.handleRequest(req, res, req.body);
    console.log("[MCP] handleRequest completed, status:", res.statusCode);
  } catch (err) {
    console.error("[MCP] handleRequest threw:", err);
    if (!res.headersSent) res.status(500).json({ error: "internal_error" });
  }
});
*/