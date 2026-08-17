// Mirror the Rust side in src-tauri/src/commands/database.rs.

export type DbEngine = "sqlite" | "postgres" | "mysql";

export interface DbConnectionProfile {
  id: number;
  label: string;
  engine: DbEngine;
  host: string | null;
  port: number | null;
  username: string | null;
  database_name: string | null;
  file_path: string | null;
  use_tls: boolean;
}

export interface DbConnectParams {
  engine: DbEngine;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database_name?: string;
  file_path?: string;
  use_tls: boolean;
}

export interface DbTableInfo {
  name: string;
  schema: string | null;
  kind: "table" | "view";
}

export interface DbColumnInfo {
  name: string;
  data_type: string;
  nullable: boolean;
  is_primary_key: boolean;
}

export interface DbQueryResult {
  columns: string[];
  rows: unknown[][];
  rows_affected: number | null;
  duration_ms: number;
  truncated: boolean;
}
