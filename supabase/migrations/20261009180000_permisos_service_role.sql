-- Permisos de service_role sobre funciones internas (hallado en producción, 9 oct 2026).
--
-- Las funciones public.admin_* y las del canje por API son SECURITY INVOKER y las ejecuta service_role (las llaman
-- /api/admin y /api/canjes con la clave secreta). Al crear estas funciones internas se revocó EXECUTE de public,
-- pero faltó concederlo a service_role, como sí se hizo con exigir_admin o aliado_por_codigo. Resultado:
-- «permission denied for function …» y el panel mostraba «Intenta de nuevo en unos minutos». Las pruebas pgTAP
-- corren como postgres y no lo detectaron. Afectaba:
--   * aprobar una solicitud (otorgar_bienvenida, migración puntos_bienvenida);
--   * guardar cursos, certificaciones y herramientas de la Academy (texto_valido, validar_contenido_curso,
--     otorgar_certificaciones);
--   * consultar y canjear por API de un proveedor (recompensas_para, registrar_canje_base).
-- El canje con QR no estaba afectado: sus funciones son SECURITY DEFINER.
-- Solo concede permisos; no cambia datos ni la lógica de ninguna función.

grant execute on function interno.otorgar_bienvenida(uuid) to service_role;
grant execute on function interno.otorgar_certificaciones(uuid, uuid) to service_role;
grant execute on function interno.texto_valido(jsonb, integer) to service_role;
grant execute on function interno.validar_contenido_curso(jsonb) to service_role;
grant execute on function interno.recompensas_para(public.aliados, text) to service_role;
grant execute on function interno.registrar_canje_base(text, text, text, text, uuid, text) to service_role;
