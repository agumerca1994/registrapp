"""MCP connector for RegistrApp.

Exposes the household's finances to an AI client (claude.ai, Claude Desktop,
Claude Code, ...) over Streamable HTTP at `/mcp`. Everything is readable; the
writes are income (`tools_income_write`), credit cards — cards, statements,
items (`tools_cards_write`) — and shared expenses (`tools_shared`). Every write tool previews by default
(`dry_run=True`) and audits when applied (`write_common`).
"""
