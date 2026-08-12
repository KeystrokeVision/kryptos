#!/usr/bin/env node
/**
 * dora-metrics.mjs
 * ------------------------------------------------------------------
 * Utilidad sin dependencias externas para registrar y resumir las
 * 4 métricas DORA (DevOps Research and Assessment) del proyecto:
 *
 *   1. Deployment Frequency  – cuántas veces se despliega (tags "vX.Y.Z")
 *   2. Lead Time for Changes – tiempo entre el primer commit tras el
 *                              último release y el nuevo release
 *   3. Change Failure Rate   – % de builds en main que terminan en falla
 *   4. MTTR                  – tiempo medio entre una falla en main y la
 *                              siguiente build exitosa que la repara
 *
 * Los eventos crudos se guardan en:
 *   metrics/deployments.jsonl
 *   metrics/failures.jsonl
 *
 * Se invoca desde los workflows de GitHub Actions:
 *   node scripts/dora-metrics.mjs record-deploy <tag> <sha>
 *   node scripts/dora-metrics.mjs record-build <conclusion> <sha> <url>
 *   node scripts/dora-metrics.mjs report
 * ------------------------------------------------------------------
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const METRICS_DIR = path.join(ROOT, "metrics");
const DEPLOYMENTS_FILE = path.join(METRICS_DIR, "deployments.jsonl");
const FAILURES_FILE = path.join(METRICS_DIR, "failures.jsonl");

function ensureMetricsDir() {
  if (!existsSync(METRICS_DIR)) mkdirSync(METRICS_DIR, { recursive: true });
}

function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function appendJsonl(file, obj) {
  ensureMetricsDir();
  appendFileSync(file, JSON.stringify(obj) + "\n", "utf8");
}

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
}

/** Devuelve el tag anterior al HEAD actual (o null si es el primero). */
function previousTag() {
  try {
    return sh("git describe --tags --abbrev=0 HEAD^");
  } catch {
    return null;
  }
}

/**
 * Lead Time for Changes: desde el primer commit posterior al release
 * anterior, hasta ahora (momento del nuevo release).
 */
function computeLeadTimeHours(prevTag) {
  const range = prevTag ? `${prevTag}..HEAD` : "HEAD";
  let firstCommitEpoch;
  try {
    const timestamps = sh(`git log --reverse --format=%ct ${range}`)
      .split("\n")
      .filter(Boolean);
    firstCommitEpoch = timestamps.length ? Number(timestamps[0]) : null;
  } catch {
    firstCommitEpoch = null;
  }
  if (!firstCommitEpoch) return null;
  const nowEpoch = Math.floor(Date.now() / 1000);
  return Number(((nowEpoch - firstCommitEpoch) / 3600).toFixed(2));
}

function cmdRecordDeploy(tag, sha) {
  const prevTag = previousTag();
  const leadTimeHours = computeLeadTimeHours(prevTag);
  appendJsonl(DEPLOYMENTS_FILE, {
    type: "deployment",
    tag,
    sha,
    previousTag: prevTag,
    leadTimeHours,
    timestamp: new Date().toISOString(),
  });
  console.log(
    `Deployment registrado: ${tag} (lead time: ${leadTimeHours ?? "N/A"}h, tag anterior: ${prevTag ?? "ninguno"})`
  );
}

function cmdRecordBuild(conclusion, sha, url) {
  const isFailure = conclusion === "failure";
  const isSuccess = conclusion === "success";

  if (isFailure) {
    appendJsonl(FAILURES_FILE, {
      type: "failure",
      sha,
      url,
      timestamp: new Date().toISOString(),
      recoveredAt: null,
      mttrHours: null,
    });
    console.log(`Falla registrada para ${sha}`);
    return;
  }

  if (isSuccess) {
    // Registrar también un evento "build" exitoso para poder calcular
    // Change Failure Rate = fallas / (fallas + éxitos).
    appendJsonl(FAILURES_FILE, {
      type: "success",
      sha,
      url,
      timestamp: new Date().toISOString(),
    });

    // Si la falla más reciente aún no tiene recuperación, este éxito
    // es el que la repara -> calculamos MTTR.
    const events = readJsonl(FAILURES_FILE);
    for (let i = events.length - 2; i >= 0; i--) {
      const ev = events[i];
      if (ev.type === "success") break; // ya hubo un éxito más reciente, no hay nada que reparar
      if (ev.type === "failure" && !ev.recoveredAt) {
        const failedAt = new Date(ev.timestamp).getTime();
        const recoveredAt = Date.now();
        const mttrHours = Number(((recoveredAt - failedAt) / 3_600_000).toFixed(2));
        console.log(`Recuperación detectada: MTTR = ${mttrHours}h (falla en ${ev.sha} -> éxito en ${sha})`);
        // Nota: por simplicidad no reescribimos el jsonl (append-only);
        // el reporte agregado recalcula el MTTR recorriendo la secuencia.
        break;
      }
    }
    return;
  }

  console.log(`Conclusión "${conclusion}" ignorada (no es success ni failure)`);
}

/** Recorre metrics/failures.jsonl emparejando cada failure con el próximo success. */
function computeChangeFailureRateAndMttr() {
  const events = readJsonl(FAILURES_FILE).sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );

  const totalBuilds = events.length;
  const totalFailures = events.filter((e) => e.type === "failure").length;
  const changeFailureRate = totalBuilds ? (totalFailures / totalBuilds) * 100 : 0;

  const mttrSamples = [];
  let openFailureAt = null;
  for (const ev of events) {
    if (ev.type === "failure" && openFailureAt === null) {
      openFailureAt = new Date(ev.timestamp).getTime();
    } else if (ev.type === "success" && openFailureAt !== null) {
      const recoveredAt = new Date(ev.timestamp).getTime();
      mttrSamples.push((recoveredAt - openFailureAt) / 3_600_000);
      openFailureAt = null;
    }
  }
  const mttrHours = mttrSamples.length
    ? mttrSamples.reduce((a, b) => a + b, 0) / mttrSamples.length
    : null;

  return { totalBuilds, totalFailures, changeFailureRate, mttrHours };
}

function computeDeploymentFrequency() {
  const deployments = readJsonl(DEPLOYMENTS_FILE);
  if (!deployments.length) return { count: 0, perWeek: 0 };

  const now = Date.now();
  const windowDays = 30;
  const recent = deployments.filter(
    (d) => now - new Date(d.timestamp).getTime() <= windowDays * 24 * 3_600_000
  );
  const perWeek = (recent.length / windowDays) * 7;
  const avgLeadTime =
    deployments.filter((d) => d.leadTimeHours != null).reduce((a, d) => a + d.leadTimeHours, 0) /
      (deployments.filter((d) => d.leadTimeHours != null).length || 1);

  return { count: deployments.length, recent: recent.length, perWeek, avgLeadTime };
}

function cmdReport() {
  const deploy = computeDeploymentFrequency();
  const { totalBuilds, totalFailures, changeFailureRate, mttrHours } =
    computeChangeFailureRateAndMttr();

  const lines = [
    "== Reporte de métricas DORA — Kryptos ==",
    "",
    `Deployment Frequency: ${deploy.count} despliegue(s) totales, ${deploy.recent ?? 0} en los últimos 30 días (~${(deploy.perWeek ?? 0).toFixed(2)}/semana)`,
    `Lead Time for Changes (promedio): ${Number.isFinite(deploy.avgLeadTime) ? deploy.avgLeadTime.toFixed(2) + "h" : "sin datos"}`,
    `Change Failure Rate: ${changeFailureRate.toFixed(1)}% (${totalFailures}/${totalBuilds} builds en main)`,
    `MTTR (Mean Time To Recovery): ${mttrHours != null ? mttrHours.toFixed(2) + "h" : "sin datos"}`,
    "",
  ];
  console.log(lines.join("\n"));
}

const [, , command, ...args] = process.argv;

switch (command) {
  case "record-deploy":
    cmdRecordDeploy(args[0], args[1]);
    break;
  case "record-build":
    cmdRecordBuild(args[0], args[1], args[2]);
    break;
  case "report":
    cmdReport();
    break;
  default:
    console.error(
      "Uso: node scripts/dora-metrics.mjs <record-deploy|record-build|report> [args]"
    );
    process.exit(1);
}
