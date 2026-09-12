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

  // Helper fetcher
  const fetchCustomerData = async () => {
    const response = await fetch(`${MCP_BACKEND_URL}/api/v1/projects`, {
      headers: { Authorization: authToken }
    });
    if (!response.ok) throw new Error(`MCP Backend status ${response.status}`);
    const result = await response.json();
    return result.data;
  };

  // -------------------------------------------------------------------------
  // WORKSPACE 1 TOOLS
  // -------------------------------------------------------------------------
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
        console.error("[MCP APP] Error querying MCP Backend:", err.message);
        return {
          isError: true,
          content: [{ type: "text", text: `Error processing request: ${err.message}` }]
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // WORKSPACE 2 TOOLS
  // -------------------------------------------------------------------------
  server.tool(
    "get_workspace2_raw",
    "Fetches raw key-value pair metrics for Workspace 2.",
    {},
    async () => {
      try {
        const data = await fetchCustomerData();
        return {
          content: [{ type: "text", text: JSON.stringify({ metrics: data.workspace2 }) }]
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
        const data = await fetchCustomerData(); // { A: 5, B: 7, C: 3 }
        const labels = Object.keys(data.workspace2).map(k => `"${k}"`).join(", ");
        const values = Object.values(data.workspace2).join(", ");

        return {
          content: [
            {
              type: "text",
              text: `Data: ${JSON.stringify(data.workspace2)}\n\n` +
                    `CRITICAL VISUALIZATION INSTRUCTION:\n` +
                    `Do NOT output ASCII text or bullet points.\n` +
                    `You MUST output a syntactically valid Mermaid.js xychart block so the UI renders an actual graphical plot card:\n\n` +
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

  server.tool(
    "get_workspace2_widget",
    "Renders an external hosted widget for Workspace 2.",
    {},
    async () => {
      try {
        const widgetUrl = `${CUSTOMER_BACKEND_URL}/widget/bar-chart`;
        // QuickChart generates an actual rendered PNG image on the fly for hosts that block iframes
        const chartImageUrl = `https://quickchart.io/chart?c={type:'bar',data:{labels:['A','B','C'],datasets:[{label:'Metrics',data:[5,7,3]}]}}`;

        return {
          content: [
            {
              type: "text",
              text: `Here is the visual chart widget for Workspace 2:\n\n` +
                    `![Workspace 2 Bar Chart](${chartImageUrl})\n\n` +
                    `🔗 [Open Live Interactive Widget Dashboard](${widgetUrl})`
            }
          ]
        };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: err.message }] };
      }
    }
  );

  // -------------------------------------------------------------------------
  // WORKSPACE 3 TOOLS
  // -------------------------------------------------------------------------
  server.tool(
    "get_workspace3_raw",
    "Fetches the raw transition sequence array from Workspace 3.",
    {},
    async () => {
      try {
        const data = await fetchCustomerData();
        const rawSequence = data.workspace3; // Array: ["D", "A", "C", "B"]

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ sequence: rawSequence })
            }
          ]
        };
      } catch (err) {
        console.error("[MCP APP] Error fetching raw sequence:", err.message);
        return {
          isError: true,
          content: [{ type: "text", text: `Error processing request: ${err.message}` }]
        };
      }
    }
  );

  server.tool(
    "get_workspace3_formatted",
    "Requests a rendered flow/transition diagram for Workspace 3.",
    {},
    async () => {
      try {
        const data = await fetchCustomerData();
        const sequence = data.workspace3; // ["D", "A", "C", "B"]

        return {
          content: [
            {
              type: "text",
              text: `Data Sequence: ${JSON.stringify(sequence)}\n\n` +
                    `CRITICAL VISUALIZATION INSTRUCTION:\n` +
                    `Do NOT output plain text like "D -> A -> C -> B".\n` +
                    `You MUST output a syntactically complete Mermaid.js graph code block so the UI renders a graphical diagram card, OR render an ASCII graph using box-drawing characters like this:\n\n` +
                    `\`\`\`mermaid\n` +
                    `graph LR\n` +
                    `    D[State D] --> A[State A]\n` +
                    `    A --> C[State C]\n` +
                    `    C --> B[State B]\n` +
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