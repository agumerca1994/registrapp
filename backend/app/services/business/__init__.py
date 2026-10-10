"""Los servicios del negocio (tenants con `kind='business'`).

Mismo contrato que el resto de `services/`: sin auth, sin commit, compartidos
por los routers, el bot y el conector MCP. Viven en su propio paquete para que
el negocio se pueda separar algún día sin desarmar el hogar.
"""
