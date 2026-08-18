# Contribuir a KRYPTOS

Gracias por el interés. Antes de nada, dos cosas importantes:

> [!IMPORTANT]
> Este repositorio es de código visible pero **no es open source**: ver
> [`LICENSE`](LICENSE). Al enviar un Pull Request aceptás que tu
> contribución pueda incorporarse al proyecto bajo esos mismos términos —
> no se acepta código con licencias de terceros incompatibles.

> [!IMPORTANT]
> KRYPTOS no incluye ni incluirá herramientas de explotación, fuerza
> bruta, inyección o intrusión contra sistemas que no sean del propio
> usuario. Ver la sección "Modo Hacker" del [README](README.md#modo-hacker-osint-pasivo-cripto-y-estética-de-terminal--todo-legal)
> para el criterio exacto que ya se aplica ahí. Cualquier propuesta que lo
> viole se cierra sin evaluar.

## Antes de escribir código

- **Bugs**: abrí un issue con la plantilla de bug antes del PR, salvo que
  sea trivial (typo, etc.)
- **Funcionalidad nueva o cambios grandes**: abrí un issue de propuesta
  primero — evita trabajo descartado si el enfoque no encaja con el
  proyecto

## Entorno de desarrollo

Ver [Requisitos](README.md#requisitos) y
[Ejecutar en desarrollo](README.md#ejecutar-en-desarrollo) en el README.
En resumen:

```bash
npm install
npm run tauri dev
```

## Convenciones del proyecto

- **Datos reales, siempre**: ningún módulo muestra datos simulados —
  ver [Filosofía de datos](README.md#filosofía-de-datos). Un PR que agregue
  un mock donde debería ir un dato real no se acepta
- **Confirmación explícita para lo destructivo**: cualquier acción que
  borre, termine un proceso, aísle una red, etc. necesita un
  `ConfirmDialog` antes de ejecutarse, y quedar en el historial de
  auditoría — ver [Seguridad y consentimiento](README.md#seguridad-y-consentimiento)
- **Tipos espejo**: cada comando de Rust en `src-tauri/src/commands/`
  tiene su tipo TypeScript correspondiente en `src/types/`, manteniendo el
  mismo shape (`snake_case` en Rust/Serde, tal cual en TS) — actualizá
  ambos lados juntos
- **Sin telemetría**: nada que llame a un servicio externo lo hace en
  silencio ni automáticamente; siempre es un botón que el usuario decide
  presionar

## Commits y Pull Requests

- Mensajes de commit descriptivos, en español, en modo imperativo
  ("Agregar…", "Corregir…"), igual que el historial existente
- Un PR por cambio lógico; si toca frontend y backend a la vez está bien,
  pero mantenelo enfocado en una sola cosa
- Completá la plantilla de PR — el checklist existe porque ya se rompió
  algo por saltárselo antes
- Si tu cambio es publicable en una versión, agregá una entrada en
  `CHANGELOG.md` bajo `[Sin publicar]` (ver [Versionado y releases](README.md#versionado-y-releases))

## Reportar una vulnerabilidad de seguridad

Si encontrás un problema de seguridad en KRYPTOS mismo (no en las
herramientas de terceros que integra), no abras un issue público — contactá
directamente a través del perfil de GitHub de
[KeystrokeVision](https://github.com/KeystrokeVision).
