import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { publicError } from "../core/errors.js";
import { RuntimeClient } from "../runtime/client.js";
import { TOOL_CATALOG } from "../tools/catalog.js";

export async function runMcpServer(): Promise<void> {
  const runtime = await RuntimeClient.connect();
  const server = new McpServer({ name: "desic-okx-agent", version: "0.1.0" });
  for (const definition of TOOL_CATALOG) {
    server.registerTool(
      definition.name,
      { description: definition.description, inputSchema: definition.schema.shape },
      async (input) => {
        try {
          const result = await runtime.call(definition.name, input);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            ...(result && typeof result === "object" && !Array.isArray(result) ? { structuredContent: result as Record<string, unknown> } : {})
          };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: JSON.stringify({ error: publicError(error) }) }]
          };
        }
      }
    );
  }
  await server.connect(new StdioServerTransport());
}
