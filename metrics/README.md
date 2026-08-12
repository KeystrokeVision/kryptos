# Métricas DevOps (DORA) — Kryptos

Esta carpeta guarda el histórico crudo usado para calcular las 4 métricas
DORA (DevOps Research and Assessment), el estándar de la industria para
medir la madurez operativa de un equipo:

| Métrica | Qué mide | Cómo se registra aquí |
|---|---|---|
| **Deployment Frequency** | Con qué frecuencia se despliega a producción | Cada tag `vX.Y.Z` dispara `.github/workflows/dora-metrics.yml`, que agrega una línea a `deployments.jsonl` |
| **Lead Time for Changes** | Tiempo desde el primer commit de un cambio hasta que llega a producción | Calculado en el mismo evento, comparando el timestamp del primer commit tras el tag anterior contra el momento del nuevo tag |
| **Change Failure Rate** | % de despliegues/builds que provocan una falla | Cada corrida del workflow `CI` en `main` (éxito o falla) se anexa a `failures.jsonl` |
| **MTTR** (Mean Time To Recovery) | Tiempo medio en reparar una falla | Se calcula emparejando cada evento `failure` con el próximo `success` en `failures.jsonl` |

## Archivos

- `deployments.jsonl` — un JSON por línea, uno por cada release (tag `vX.Y.Z`).
- `failures.jsonl` — un JSON por línea, uno por cada corrida de CI en `main`
  (tipo `failure` o `success`).

Formato *append-only*: nunca se editan líneas existentes, solo se agregan
nuevas. Esto mantiene el historial íntegro y auditable.

## Cómo generar despliegues (y que se registre Deployment Frequency / Lead Time)

```bash
git tag v0.2.0
git push origin v0.2.0
```

Esto dispara `dora-metrics.yml`, que calcula el lead time y agrega la
entrada correspondiente.

## Ver el reporte agregado

```bash
npm run dora:report
```

Imprime un resumen con las 4 métricas calculadas a partir de los archivos
`.jsonl` actuales (funciona local o en CI).

## Automatización

- `.github/workflows/ci.yml` — build/typecheck en cada push/PR a `main`
  (Build Success Rate, duración de pipeline).
- `.github/workflows/dora-metrics.yml` — registra despliegues y resultados
  de build para alimentar las 4 métricas DORA.
- `scripts/dora-metrics.mjs` — lógica de cálculo, sin dependencias externas.
