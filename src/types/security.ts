// Mirror the Rust side in src-tauri/src/commands/security.rs. Field names
// are snake_case on purpose — matches the project's existing convention
// (see types/system.ts) since none of these structs use serde rename_all.

export interface FileHashEntry {
  path: string;
  sha256: string;
  size_bytes: number;
  modified_unix: number;
}

export interface DirectoryHashResult {
  entries: FileHashEntry[];
  truncated: boolean;
}

export interface BaselineSummary {
  name: string;
  root_path: string;
  created_at_unix: number;
  file_count: number;
}

export interface DriftReport {
  baseline_name: string;
  added: string[];
  removed: string[];
  modified: string[];
  unchanged_count: number;
  scanned_at_unix: number;
}

export interface TlsCertificateInfo {
  host: string;
  port: number;
  subject: string;
  issuer: string;
  not_before: string;
  not_after: string;
  days_until_expiry: number;
  is_expired: boolean;
  is_self_signed: boolean;
  serial_number: string;
  signature_algorithm_oid: string;
  subject_alt_names: string[];
}

export interface CveResult {
  id: string;
  published: string | null;
  last_modified: string | null;
  vuln_status: string | null;
  description: string;
  cvss_score: number | null;
  cvss_severity: string | null;
  cvss_vector: string | null;
  references: string[];
}

export interface CveSearchResult {
  total_results: number;
  results: CveResult[];
}

export interface CommandOutput {
  success: boolean;
  output: string;
}

export interface SecurityLogEntry {
  time: string | null;
  event_id: number | null;
  level: string | null;
  message: string;
}

export interface SecurityLogResult {
  entries: SecurityLogEntry[];
  source: string;
}

export interface FirewallRule {
  id: string;
  name: string;
  enabled: boolean | null;
  direction: string | null;
  action: string | null;
  protocol: string | null;
  local_port: string | null;
}
