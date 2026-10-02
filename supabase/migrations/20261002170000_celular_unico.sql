-- Un celular pertenece a un solo aliado (decisión del equipo, octubre de 2026).
-- Clientify une en un solo contacto los que comparten celular: dos aliados con el mismo celular terminarían
-- en el mismo contacto y el segundo no podría sincronizarse. El celular ya se guarda en formato E.164, así que
-- la comparación es exacta. Un registro con un celular usado se rechaza completo: el trigger de alta falla y
-- Supabase Auth no crea el usuario (§3).
create unique index aliados_celular_key on public.aliados (celular);
