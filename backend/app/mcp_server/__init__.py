"""MCP connector for RegistrApp.

Exposes the household's finances to an AI client (claude.ai, Claude Desktop,
Claude Code, ...) over Streamable HTTP at `/mcp`. Everything is readable; the
only writes are income entries and their sources (`tools_income_write`), and
every write tool previews by default (`dry_run=True`) and audits when applied.
"""
