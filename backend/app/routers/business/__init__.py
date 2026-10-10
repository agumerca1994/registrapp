"""Los routers del negocio. Todos usan `get_owner_user` / `get_staff_user`
(core/access.py): la guardia de empleados viene en la propia dependencia que
les da el usuario, así que no hace falta otra copia de `_get_db_user`."""
