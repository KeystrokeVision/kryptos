// Mirror the Rust side in src-tauri/src/commands/dossier.rs.

import type { ConnectionInfo } from "@/types/network";
import type { SentinelEvent } from "@/types/sentinel";

export interface SignatureInfo {
  /** "valida" | "invalida" | "no_firmado" | "no_disponible" */
  status: "valida" | "invalida" | "no_firmado" | "no_disponible";
  subject: string | null;
}

export interface AncestorInfo {
  pid: number;
  name: string;
}

export interface ProcessDossier {
  pid: number;
  name: string;
  exe_path: string | null;
  cmd: string[];
  status: string;
  cpu_usage_percent: number;
  memory_bytes: number;
  start_time_unix: number;
  parent_pid: number | null;
  parent_name: string | null;
  ancestors: AncestorInfo[];
  sha256: string | null;
  signature: SignatureInfo;
  connections: ConnectionInfo[];
  related_events: SentinelEvent[];
}
