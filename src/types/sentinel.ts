// Mirror the Rust side in src-tauri/src/commands/sentinel.rs.

export type SentinelSeverity = "critica" | "alta" | "media" | "baja";

/** De donde salio el cambio: que subsistema lo reporto. */
export type SentinelSource = "red" | "persistencia" | "linea-base" | "motor" | "procesos" | "honeytoken" | "usb";

export interface SentinelEvent {
  id: number;
  timestamp_unix: number;
  source: SentinelSource;
  kind: string;
  subject: string;
  detail: string | null;
}

export interface SentinelAlert {
  id: number;
  timestamp_unix: number;
  rule_id: string;
  severity: SentinelSeverity;
  title: string;
  detail: string;
  event_id: number | null;
  acknowledged: boolean;
  /** Tecnica de MITRE ATT&CK asociada (contexto, no una atribucion certera). */
  mitre_id: string | null;
}

export interface SentinelStatus {
  running: boolean;
  interval_secs: number;
  last_run_unix: number;
  /** false hasta que exista una foto de referencia contra la cual comparar. */
  has_baseline: boolean;
  event_count: number;
  alert_count: number;
  unacknowledged_count: number;
  watched_ports: number;
  watched_persistence: number;
  /** 0-100, mas alto es mejor: linea base combinada con alertas pendientes. */
  posture_score: number;
}

export interface ScanOutcome {
  new_events: number;
  new_alerts: number;
  baseline_established: boolean;
}

export interface SentinelExport {
  json: string;
  sha256: string;
  event_count: number;
  alert_count: number;
  exported_at_unix: number;
}

export interface KeyValue {
  key: string;
  value: string;
}

export interface ReconstructedState {
  as_of_unix: number;
  ports: KeyValue[];
  persistence: KeyValue[];
  baseline: KeyValue[];
  baseline_score: number | null;
  events_replayed: number;
}

export interface SentinelTimeBounds {
  earliest_unix: number | null;
  latest_unix: number | null;
}
