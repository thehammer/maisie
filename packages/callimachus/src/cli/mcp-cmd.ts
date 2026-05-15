/**
 * `calli mcp` — Start the Callimachus MCP stdio server.
 */
export async function mcpCommand(): Promise<void> {
  // Import and run the MCP server entry point
  await import('../mcp/server.js')
}
