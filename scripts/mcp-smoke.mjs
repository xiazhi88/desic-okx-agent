import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readRuntimeState } from "../dist/runtime/state.js";
import { RuntimeClient } from "../dist/runtime/client.js";

const existing = readRuntimeState();
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/cli/index.js", "mcp"],
  stderr: "pipe"
});
const client = new Client({ name: "desic-okx-agent-smoke", version: "1.0.0" });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  if (listed.tools.length < 60) throw new Error(`Expected the complete tool catalog, received ${listed.tools.length}`);
  await client.close();
  const first = await RuntimeClient.connect({ start: false });
  const second = await RuntimeClient.connect({ start: false });
  const [firstHealth, secondHealth] = await Promise.all([first.health(), second.health()]);
  if (firstHealth.instanceId !== secondHealth.instanceId) throw new Error("Clients did not reuse the same runtime instance");
  if (!existing) await first.stop();
} catch (error) {
  try { await client.close(); } catch {}
  throw error;
}
