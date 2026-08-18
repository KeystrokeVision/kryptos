## Qué hace este PR

<!-- Resumen corto. Si cierra un issue, escribí "Closes #123". -->

## Tipo de cambio

- [ ] Fix (corrige un bug sin romper compatibilidad)
- [ ] Feature (agrega funcionalidad nueva)
- [ ] Refactor / limpieza interna, sin cambio de comportamiento
- [ ] Documentación (README, CHANGELOG, comentarios)
- [ ] DevOps / CI-CD

## Checklist

- [ ] `npm run build` (o `tsc -b`) pasa sin errores
- [ ] Probado manualmente en `npm run tauri dev`
- [ ] Si agrega/cambia un comando de Rust: el tipo TypeScript espejo en `src/types/` quedó sincronizado
- [ ] Si es user-facing: el módulo correspondiente en el README (`README.md`) quedó actualizado
- [ ] Si es una versión publicable: `CHANGELOG.md` tiene una entrada bajo `[Sin publicar]`
- [ ] Ninguna acción destructiva nueva se ejecuta sin confirmación explícita (ver "Seguridad y consentimiento" en el README)

## Notas para quien revisa

<!-- Cualquier cosa que no sea obvia del diff: decisiones de diseño,
     compromisos aceptados a propósito, qué falta probar todavía. -->
