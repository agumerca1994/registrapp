"""Read-only MCP connector for RegistrApp.

Exposes the household's finances to an AI client (claude.ai, Claude Desktop,
Claude Code, ...) over Streamable HTTP at `/mcp`. No tool in this package ever
writes: the connector answers questions and runs simulations, nothing else.
"""
