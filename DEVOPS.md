# Métricas DevOps y Rendimiento Operativo — Kryptos

Este proyecto implementa pipelines equivalentes en las 4 plataformas
descritas en la tabla de "Métricas DevOps y Rendimiento Operativo",
todas alimentando el mismo sistema de registro (`metrics/*.jsonl` +
`scripts/dora-metrics.mjs`) para que las métricas sean comparables sin
importar la herramienta:

| Herramienta | Archivo en este repo | Métricas soportadas | Estado |
|---|---|---|---|
| **GitHub Actions** | [`.github/workflows/ci.yml`](.github/workflows/ci.yml), [`.github/workflows/dora-metrics.yml`](.github/workflows/dora-metrics.yml) | Deployment Frequency, Lead Time, MTTR, Change Failure Rate | ✅ Activo (el repo vive en GitHub) |
| **Azure DevOps** | [`azure-pipelines.yml`](azure-pipelines.yml) | Tiempo de despliegue, frecuencia de liberación, tasa de fallos en builds | 🧩 Plantilla lista — requiere importar el repo a un proyecto de Azure DevOps |
| **Jenkins** | [`Jenkinsfile`](Jenkinsfile) | Build Success Rate, duración de pipelines, análisis de fallos en CI | 🧩 Plantilla lista — requiere un controlador Jenkins con plugin NodeJS |
| **CircleCI** | [`.circleci/config.yml`](.circleci/config.yml) | Build Success Rate, duración de pipelines, análisis de fallos en CI | 🧩 Plantilla lista — requiere conectar el repo en circleci.com |
| **Harness** | [`.harness/kryptos-pipeline.yaml`](.harness/kryptos-pipeline.yaml) | Deployment Frequency, automatización de rollbacks, análisis de impacto en despliegues | 🧩 Plantilla de referencia — requiere cuenta/proyecto Harness y conectores propios |

## Por qué solo GitHub Actions está "activo"

El repositorio de Kryptos vive en GitHub (`KeystrokeVision/kryptos`), así
que **GitHub Actions corre automáticamente sin configuración extra**.
Las otras tres plataformas (Azure DevOps, Jenkins, CircleCI) son
sistemas externos independientes: solo se activan si el proyecto se
conecta explícitamente a ellas (importando el repo, dando permisos,
instalando agentes, etc.). Por eso sus archivos quedan como
**plantillas listas para usar**, no como pipelines corriendo hoy.

Harness, además de requerir cuenta propia, asume por defecto un
despliegue a Kubernetes en su ejemplo de rollback/análisis de impacto,
lo cual no aplica directamente a Kryptos (app de escritorio Tauri) —
ver la nota dentro de `.harness/kryptos-pipeline.yaml` para adaptarlo
al destino real (p. ej. publicar instaladores en GitHub Releases).

## Métricas DORA — detalle

Ver [`metrics/README.md`](metrics/README.md) para el detalle del
esquema de datos (`deployments.jsonl` / `failures.jsonl`) y cómo leer
el reporte con `npm run dora:report`.
