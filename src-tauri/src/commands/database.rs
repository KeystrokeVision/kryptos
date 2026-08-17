//! Modulo Base de datos: cliente real para SQLite, PostgreSQL y MySQL.
//!
//! Mismo patron que ssh.rs: perfiles de conexion (metadatos, nunca la
//! contrasena) guardados en la base local de KRYPTOS, mas un mapa de
//! conexiones "vivas" en memoria (`DatabaseManager`) indexado por un
//! `session_id` que elige el frontend — una pestana de la UI, una sesion.
//!
//! Los tres motores exponen APIs completamente distintas en Rust
//! (rusqlite / postgres / mysql), asi que cada operacion (listar tablas,
//! listar columnas, correr una consulta) tiene una rama por motor. El
//! resultado de una consulta siempre se normaliza a JSON (`serde_json::Value`)
//! por celda para que el frontend dibuje una sola grilla generica sin saber
//! nada de tipos de Postgres o MySQL.

use std::collections::HashMap;
use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use mysql::prelude::Queryable;
use postgres::types::Type as PgType;
use rusqlite::params;
use rusqlite::types::ValueRef;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};
use tauri::State;

use crate::commands::audit::record_audit_event;
use crate::db::Db;

/// Techo de filas devueltas al frontend por consulta. Una consulta que
/// devuelve mas se marca `truncated: true` — evita que un `SELECT *` sin
/// `LIMIT` sobre una tabla de millones de filas cuelgue la UI intentando
/// dibujar una grilla gigante.
const MAX_ROWS: usize = 1000;

// ---------------------------------------------------------------------
// Perfiles guardados (metadatos unicamente — la contrasena nunca se
// persiste, se pide de nuevo cada vez que se conecta, igual que SSH).
// ---------------------------------------------------------------------

#[derive(Serialize)]
pub struct DbConnectionProfile {
    pub id: i64,
    pub label: String,
    pub engine: String, // "sqlite" | "postgres" | "mysql"
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub database_name: Option<String>,
    pub file_path: Option<String>,
    pub use_tls: bool,
}

#[tauri::command]
pub fn list_db_connections(db: State<'_, Db>) -> Result<Vec<DbConnectionProfile>, String> {
    let conn = db.0.lock().map_err(|_| "No se pudo acceder a las conexiones guardadas.".to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, label, engine, host, port, username, database_name, file_path, use_tls FROM db_connections ORDER BY label COLLATE NOCASE ASC")
        .map_err(|e| format!("No se pudo consultar las conexiones: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(DbConnectionProfile {
                id: row.get(0)?,
                label: row.get(1)?,
                engine: row.get(2)?,
                host: row.get(3)?,
                port: row.get::<_, Option<i64>>(4)?.map(|p| p as u16),
                username: row.get(5)?,
                database_name: row.get(6)?,
                file_path: row.get(7)?,
                use_tls: row.get::<_, i64>(8)? != 0,
            })
        })
        .map_err(|e| format!("No se pudo leer las conexiones: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("No se pudo leer una conexion: {e}"))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn add_db_connection(
    db: State<'_, Db>,
    label: String,
    engine: String,
    host: Option<String>,
    port: Option<u16>,
    username: Option<String>,
    database_name: Option<String>,
    file_path: Option<String>,
    use_tls: bool,
) -> Result<DbConnectionProfile, String> {
    if label.trim().is_empty() {
        return Err("El nombre de la conexion es obligatorio.".into());
    }
    if !["sqlite", "postgres", "mysql"].contains(&engine.as_str()) {
        return Err(format!("Motor de base de datos invalido: '{engine}'."));
    }
    let created_at_unix = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);

    let conn = db.0.lock().map_err(|_| "No se pudo acceder a las conexiones guardadas.".to_string())?;
    conn.execute(
        "INSERT INTO db_connections (label, engine, host, port, username, database_name, file_path, use_tls, created_at_unix) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![label, engine, host, port.map(|p| p as i64), username, database_name, file_path, use_tls as i64, created_at_unix],
    )
    .map_err(|e| format!("No se pudo guardar la conexion: {e}"))?;

    let id = conn.last_insert_rowid();
    Ok(DbConnectionProfile { id, label, engine, host, port, username, database_name, file_path, use_tls })
}

#[tauri::command]
pub fn delete_db_connection(db: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|_| "No se pudo acceder a las conexiones guardadas.".to_string())?;
    conn.execute("DELETE FROM db_connections WHERE id = ?1", params![id]).map_err(|e| format!("No se pudo eliminar la conexion: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------
// Conexiones vivas
// ---------------------------------------------------------------------

#[derive(Deserialize, Clone)]
pub struct DbConnectParams {
    pub engine: String,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub database_name: Option<String>,
    pub file_path: Option<String>,
    pub use_tls: bool,
}

enum LiveConn {
    Sqlite(rusqlite::Connection),
    Postgres(postgres::Client),
    MySql(mysql::Conn),
}

#[derive(Default)]
pub struct DatabaseManager(StdMutex<HashMap<String, LiveConn>>);

fn describe_target(params: &DbConnectParams) -> String {
    match params.engine.as_str() {
        "sqlite" => params.file_path.clone().unwrap_or_default(),
        _ => format!(
            "{}@{}:{}/{}",
            params.username.clone().unwrap_or_default(),
            params.host.clone().unwrap_or_default(),
            params.port.unwrap_or(0),
            params.database_name.clone().unwrap_or_default()
        ),
    }
}

/// Abre una conexion real contra el motor pedido y devuelve, ademas, un
/// texto corto ("PostgreSQL 16.2", "SQLite 3.45 — C:\...\app.db") que la UI
/// muestra como confirmacion de que la conexion sirve de verdad — no un
/// simple `true`/`false`.
fn open_connection(params: &DbConnectParams) -> Result<(LiveConn, String), String> {
    match params.engine.as_str() {
        "sqlite" => {
            let path = params
                .file_path
                .as_deref()
                .map(str::trim)
                .filter(|p| !p.is_empty())
                .ok_or_else(|| "Falta la ruta del archivo SQLite.".to_string())?;
            let conn = rusqlite::Connection::open(path).map_err(|e| format!("No se pudo abrir el archivo SQLite: {e}"))?;
            conn.execute_batch("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;").ok();
            let version: String = conn.query_row("SELECT sqlite_version()", [], |r| r.get(0)).unwrap_or_else(|_| "?".into());
            Ok((LiveConn::Sqlite(conn), format!("SQLite {version} — {path}")))
        }

        "postgres" => {
            let mut config = postgres::Config::new();
            config.host(params.host.as_deref().map(str::trim).filter(|h| !h.is_empty()).unwrap_or("localhost"));
            config.port(params.port.unwrap_or(5432));
            if let Some(u) = params.username.as_deref().filter(|s| !s.is_empty()) {
                config.user(u);
            }
            if let Some(pw) = params.password.as_deref() {
                config.password(pw);
            }
            config.dbname(params.database_name.as_deref().map(str::trim).filter(|s| !s.is_empty()).unwrap_or("postgres"));
            config.connect_timeout(Duration::from_secs(8));
            config.application_name("kryptos");

            let connect_result = if params.use_tls {
                config.ssl_mode(postgres::config::SslMode::Prefer);
                // Cifra la conexion pero no valida el certificado del
                // servidor — mismo criterio que el verificador TLS de
                // Seguridad (security.rs): el objetivo es que un Postgres
                // con certificado autofirmado (el caso comun en Docker/
                // desarrollo) conecte sin friccion, no operar como cliente
                // de produccion con CA propia.
                let connector = native_tls::TlsConnector::builder()
                    .danger_accept_invalid_certs(true)
                    .danger_accept_invalid_hostnames(true)
                    .build()
                    .map_err(|e| format!("No se pudo preparar el cliente TLS: {e}"))?;
                config.connect(postgres_native_tls::MakeTlsConnector::new(connector))
            } else {
                config.ssl_mode(postgres::config::SslMode::Disable);
                config.connect(postgres::NoTls)
            };

            let mut client = connect_result.map_err(|e| format!("No se pudo conectar a PostgreSQL: {e}"))?;
            let version: String = client
                .query_one("SHOW server_version", &[])
                .ok()
                .and_then(|r| r.try_get::<_, String>(0).ok())
                .unwrap_or_else(|| "?".into());
            Ok((LiveConn::Postgres(client), format!("PostgreSQL {version}")))
        }

        "mysql" => {
            let mut builder = mysql::OptsBuilder::new()
                .ip_or_hostname(Some(params.host.clone().map(|h| h.trim().to_string()).filter(|h| !h.is_empty()).unwrap_or_else(|| "127.0.0.1".to_string())))
                .tcp_port(params.port.unwrap_or(3306))
                .user(params.username.clone().filter(|s| !s.trim().is_empty()))
                .pass(params.password.clone())
                .db_name(params.database_name.clone().filter(|s| !s.trim().is_empty()))
                .prefer_socket(false);

            if params.use_tls {
                let ssl_opts = mysql::SslOpts::default().with_danger_accept_invalid_certs(true).with_danger_skip_domain_validation(true);
                builder = builder.ssl_opts(Some(ssl_opts));
            }

            let conn = mysql::Conn::new(builder).map_err(|e| format!("No se pudo conectar a MySQL: {e}"))?;
            let (major, minor, patch) = conn.server_version();
            Ok((LiveConn::MySql(conn), format!("MySQL {major}.{minor}.{patch}")))
        }

        other => Err(format!("Motor de base de datos desconocido: '{other}'.")),
    }
}

#[tauri::command]
pub fn db_test_connection(params: DbConnectParams) -> Result<String, String> {
    let (_conn, info) = open_connection(&params)?;
    Ok(info)
}

#[tauri::command]
pub fn db_connect(manager: State<'_, DatabaseManager>, db: State<'_, Db>, session_id: String, params: DbConnectParams) -> Result<String, String> {
    {
        let map = manager.0.lock().map_err(|_| "Estado de conexiones bloqueado.".to_string())?;
        if map.contains_key(&session_id) {
            return Err(format!("La sesion '{session_id}' ya existe."));
        }
    }

    let (conn, info) = open_connection(&params)?;

    {
        let mut map = manager.0.lock().map_err(|_| "Estado de conexiones bloqueado.".to_string())?;
        map.insert(session_id, conn);
    }

    record_audit_event(&db, "db_connect", &describe_target(&params), "ok", Some(&info));
    Ok(info)
}

#[tauri::command]
pub fn db_disconnect(manager: State<'_, DatabaseManager>, session_id: String) -> Result<(), String> {
    let mut map = manager.0.lock().map_err(|_| "Estado de conexiones bloqueado.".to_string())?;
    map.remove(&session_id);
    Ok(())
}

// ---------------------------------------------------------------------
// Esquema: tablas y columnas
// ---------------------------------------------------------------------

#[derive(Serialize)]
pub struct DbTableInfo {
    pub name: String,
    pub schema: Option<String>,
    pub kind: String, // "table" | "view"
}

#[derive(Serialize)]
pub struct DbColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
}

fn quote_ident_dquote(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

fn quote_ident_backtick(s: &str) -> String {
    format!("`{}`", s.replace('`', "``"))
}

#[tauri::command]
pub fn db_list_tables(manager: State<'_, DatabaseManager>, session_id: String) -> Result<Vec<DbTableInfo>, String> {
    let mut map = manager.0.lock().map_err(|_| "Estado de conexiones bloqueado.".to_string())?;
    let conn = map.get_mut(&session_id).ok_or_else(|| "La sesion ya no esta activa. Reconecta.".to_string())?;

    match conn {
        LiveConn::Sqlite(c) => {
            let mut stmt = c
                .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
                .map_err(|e| format!("No se pudo listar tablas: {e}"))?;
            let rows = stmt
                .query_map([], |row| {
                    let name: String = row.get(0)?;
                    let kind: String = row.get(1)?;
                    Ok(DbTableInfo { name, schema: None, kind })
                })
                .map_err(|e| format!("No se pudo listar tablas: {e}"))?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("No se pudo leer una tabla: {e}"))
        }

        LiveConn::Postgres(c) => {
            let rows = c
                .query(
                    "SELECT table_schema, table_name, table_type FROM information_schema.tables \
                     WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema, table_name",
                    &[],
                )
                .map_err(|e| format!("No se pudo listar tablas: {e}"))?;
            Ok(rows
                .iter()
                .map(|r| {
                    let schema: String = r.get(0);
                    let name: String = r.get(1);
                    let table_type: String = r.get(2);
                    DbTableInfo { name, schema: Some(schema), kind: if table_type == "VIEW" { "view".into() } else { "table".into() } }
                })
                .collect())
        }

        LiveConn::MySql(c) => {
            let rows: Vec<(String, String)> = c
                .query("SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name")
                .map_err(|e| format!("No se pudo listar tablas: {e}"))?;
            Ok(rows
                .into_iter()
                .map(|(name, table_type)| DbTableInfo { name, schema: None, kind: if table_type == "VIEW" { "view".into() } else { "table".into() } })
                .collect())
        }
    }
}

#[tauri::command]
pub fn db_list_columns(manager: State<'_, DatabaseManager>, session_id: String, table: String) -> Result<Vec<DbColumnInfo>, String> {
    let mut map = manager.0.lock().map_err(|_| "Estado de conexiones bloqueado.".to_string())?;
    let conn = map.get_mut(&session_id).ok_or_else(|| "La sesion ya no esta activa. Reconecta.".to_string())?;

    match conn {
        LiveConn::Sqlite(c) => {
            let sql = format!("PRAGMA table_info({})", quote_ident_dquote(&table));
            let mut stmt = c.prepare(&sql).map_err(|e| format!("No se pudo listar columnas: {e}"))?;
            let rows = stmt
                .query_map([], |row| {
                    let name: String = row.get(1)?;
                    let data_type: String = row.get(2)?;
                    let notnull: i64 = row.get(3)?;
                    let pk: i64 = row.get(5)?;
                    Ok(DbColumnInfo { name, data_type, nullable: notnull == 0, is_primary_key: pk > 0 })
                })
                .map_err(|e| format!("No se pudo listar columnas: {e}"))?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("No se pudo leer una columna: {e}"))
        }

        LiveConn::Postgres(c) => {
            let (schema, tbl) = match table.split_once('.') {
                Some((s, t)) => (s.to_string(), t.to_string()),
                None => ("public".to_string(), table.clone()),
            };
            let rows = c
                .query(
                    "SELECT c.column_name, c.data_type, c.is_nullable, \
                        EXISTS ( \
                            SELECT 1 FROM information_schema.table_constraints tc \
                            JOIN information_schema.key_column_usage kcu \
                              ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema \
                            WHERE tc.constraint_type = 'PRIMARY KEY' \
                              AND tc.table_schema = c.table_schema AND tc.table_name = c.table_name \
                              AND kcu.column_name = c.column_name \
                        ) AS is_pk \
                     FROM information_schema.columns c \
                     WHERE c.table_schema = $1 AND c.table_name = $2 \
                     ORDER BY c.ordinal_position",
                    &[&schema, &tbl],
                )
                .map_err(|e| format!("No se pudo listar columnas: {e}"))?;
            Ok(rows
                .iter()
                .map(|r| {
                    let name: String = r.get(0);
                    let data_type: String = r.get(1);
                    let is_nullable: String = r.get(2);
                    let is_pk: bool = r.get(3);
                    DbColumnInfo { name, data_type, nullable: is_nullable == "YES", is_primary_key: is_pk }
                })
                .collect())
        }

        LiveConn::MySql(c) => {
            let sql = format!("SHOW COLUMNS FROM {}", quote_ident_backtick(&table));
            let rows: Vec<(String, String, String, String, Option<String>, String)> = c.query(&sql).map_err(|e| format!("No se pudo listar columnas: {e}"))?;
            Ok(rows
                .into_iter()
                .map(|(field, col_type, is_null, key, _default, _extra)| DbColumnInfo {
                    name: field,
                    data_type: col_type,
                    nullable: is_null == "YES",
                    is_primary_key: key == "PRI",
                })
                .collect())
        }
    }
}

// ---------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------

#[derive(Serialize, Default)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Json>>,
    pub rows_affected: Option<u64>,
    pub duration_ms: u64,
    pub truncated: bool,
}

/// Heuristica simple: mira solo la primera palabra para decidir si la
/// sentencia devuelve filas (rama `query`) o no (rama `execute`, que
/// reporta filas afectadas en vez de una grilla). No es un parser SQL —
/// no hace falta serlo para esta decision binaria.
fn looks_like_select(sql: &str) -> bool {
    let first_word: String = sql.trim_start().chars().take_while(|c| c.is_alphabetic()).collect::<String>().to_uppercase();
    matches!(first_word.as_str(), "SELECT" | "WITH" | "SHOW" | "EXPLAIN" | "PRAGMA" | "DESC" | "DESCRIBE" | "VALUES")
}

fn sqlite_cell_to_json(row: &rusqlite::Row, idx: usize) -> Json {
    match row.get_ref(idx) {
        Ok(ValueRef::Null) => Json::Null,
        Ok(ValueRef::Integer(i)) => json!(i),
        Ok(ValueRef::Real(f)) => json!(f),
        Ok(ValueRef::Text(t)) => Json::String(String::from_utf8_lossy(t).to_string()),
        Ok(ValueRef::Blob(b)) => Json::String(format!("\\x{}", b.iter().map(|x| format!("{x:02x}")).collect::<String>())),
        Err(_) => Json::Null,
    }
}

fn run_sqlite_query(c: &mut rusqlite::Connection, sql: &str, is_select: bool) -> Result<QueryResult, String> {
    if is_select {
        let mut stmt = c.prepare(sql).map_err(|e| format!("Error de sintaxis SQL: {e}"))?;
        let columns: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let col_count = columns.len();

        let mut rows_out = Vec::new();
        let mut truncated = false;
        let mut rows = stmt.query([]).map_err(|e| format!("Error al ejecutar la consulta: {e}"))?;
        while let Some(row) = rows.next().map_err(|e| format!("Error al leer resultados: {e}"))? {
            if rows_out.len() >= MAX_ROWS {
                truncated = true;
                break;
            }
            rows_out.push((0..col_count).map(|i| sqlite_cell_to_json(row, i)).collect());
        }
        Ok(QueryResult { columns, rows: rows_out, rows_affected: None, duration_ms: 0, truncated })
    } else {
        let affected = c.execute(sql, []).map_err(|e| format!("Error al ejecutar la sentencia: {e}"))?;
        Ok(QueryResult { rows_affected: Some(affected as u64), ..Default::default() })
    }
}

/// Convierte el formato binario de `NUMERIC` de Postgres (grupos base-10000,
/// con `weight`/`sign`/`dscale` — el mismo formato interno que usa
/// `numeric.c`) a su representacion decimal en texto. `postgres-types` no
/// trae un tipo Rust nativo para NUMERIC sin sumar una dependencia extra
/// (`rust_decimal`), y perder precision convirtiendo a `f64` es peor que
/// tener este parser chico y autocontenido.
struct PgNumeric(String);

impl<'a> postgres::types::FromSql<'a> for PgNumeric {
    fn from_sql(_ty: &PgType, raw: &'a [u8]) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        if raw.len() < 8 {
            return Err("numeric: buffer demasiado corto".into());
        }
        let ndigits = u16::from_be_bytes([raw[0], raw[1]]) as usize;
        let weight = i16::from_be_bytes([raw[2], raw[3]]) as isize;
        let sign = u16::from_be_bytes([raw[4], raw[5]]);
        let dscale = u16::from_be_bytes([raw[6], raw[7]]) as usize;

        if sign == 0xC000 {
            return Ok(PgNumeric("NaN".to_string()));
        }

        let mut digits = Vec::with_capacity(ndigits);
        let mut pos = 8;
        for _ in 0..ndigits {
            if pos + 2 > raw.len() {
                return Err("numeric: digitos truncados".into());
            }
            digits.push(u16::from_be_bytes([raw[pos], raw[pos + 1]]));
            pos += 2;
        }

        let mut int_part = String::new();
        let mut frac_part = String::new();
        // `weight` puede ser negativo (numero puramente fraccionario, ej.
        // 0.5) — clampear a 0 antes de castear a usize evita que un
        // isize negativo desborde al castear. En ese caso alcanza con
        // recorrer los digitos que realmente estan guardados.
        let last_index = (weight.max(0) as usize).max(ndigits.saturating_sub(1));
        for i in 0..=last_index {
            let d = digits.get(i).copied().unwrap_or(0);
            let group = format!("{d:04}");
            if (i as isize) <= weight {
                int_part.push_str(&group);
            } else {
                frac_part.push_str(&group);
            }
        }
        if int_part.is_empty() {
            int_part.push('0');
        }
        let int_trimmed = int_part.trim_start_matches('0');
        let int_final = if int_trimmed.is_empty() { "0" } else { int_trimmed };

        let mut s = String::new();
        if sign == 0x4000 {
            s.push('-');
        }
        s.push_str(int_final);
        if dscale > 0 {
            let mut frac = frac_part;
            while frac.len() < dscale {
                frac.push('0');
            }
            frac.truncate(dscale);
            s.push('.');
            s.push_str(&frac);
        }
        Ok(PgNumeric(s))
    }

    fn accepts(ty: &PgType) -> bool {
        matches!(*ty, PgType::NUMERIC)
    }
}

fn pg_cell_to_json(row: &postgres::Row, idx: usize) -> Json {
    let col_type = row.columns()[idx].type_().clone();

    macro_rules! try_get {
        ($t:ty) => {
            match row.try_get::<_, Option<$t>>(idx) {
                Ok(Some(v)) => return json!(v),
                Ok(None) => return Json::Null,
                Err(_) => {}
            }
        };
    }

    match col_type {
        PgType::BOOL => try_get!(bool),
        PgType::INT2 => try_get!(i16),
        PgType::INT4 => try_get!(i32),
        PgType::OID => try_get!(u32),
        PgType::INT8 => try_get!(i64),
        PgType::FLOAT4 => try_get!(f32),
        PgType::FLOAT8 => try_get!(f64),
        PgType::TEXT | PgType::VARCHAR | PgType::BPCHAR | PgType::NAME => try_get!(String),
        PgType::JSON | PgType::JSONB => try_get!(Json),
        PgType::UUID => {
            if let Ok(Some(v)) = row.try_get::<_, Option<uuid::Uuid>>(idx) {
                return Json::String(v.to_string());
            }
        }
        PgType::DATE => {
            if let Ok(Some(v)) = row.try_get::<_, Option<chrono::NaiveDate>>(idx) {
                return Json::String(v.to_string());
            }
        }
        PgType::TIMESTAMP => {
            if let Ok(Some(v)) = row.try_get::<_, Option<chrono::NaiveDateTime>>(idx) {
                return Json::String(v.to_string());
            }
        }
        PgType::TIMESTAMPTZ => {
            if let Ok(Some(v)) = row.try_get::<_, Option<chrono::DateTime<chrono::Utc>>>(idx) {
                return Json::String(v.to_rfc3339());
            }
        }
        PgType::INET | PgType::CIDR => {
            if let Ok(Some(v)) = row.try_get::<_, Option<std::net::IpAddr>>(idx) {
                return Json::String(v.to_string());
            }
        }
        PgType::BYTEA => {
            if let Ok(Some(v)) = row.try_get::<_, Option<Vec<u8>>>(idx) {
                return Json::String(format!("\\x{}", v.iter().map(|b| format!("{b:02x}")).collect::<String>()));
            }
        }
        PgType::NUMERIC => {
            if let Ok(Some(v)) = row.try_get::<_, Option<PgNumeric>>(idx) {
                return Json::String(v.0);
            }
        }
        _ => {}
    }

    // Tipo sin conversion directa arriba (arrays, enums propios, tipos
    // geometricos/de rango, etc.): se muestra el nombre del tipo entre
    // corchetes en vez de fallar toda la consulta por una sola columna.
    Json::String(format!("<{}>", col_type.name()))
}

fn run_postgres_query(c: &mut postgres::Client, sql: &str, is_select: bool) -> Result<QueryResult, String> {
    if is_select {
        let stmt = c.prepare(sql).map_err(|e| format!("Error de sintaxis SQL: {e}"))?;
        let columns: Vec<String> = stmt.columns().iter().map(|col| col.name().to_string()).collect();
        let rows = c.query(&stmt, &[]).map_err(|e| format!("Error al ejecutar la consulta: {e}"))?;
        let truncated = rows.len() > MAX_ROWS;
        let rows_out = rows.iter().take(MAX_ROWS).map(|row| (0..row.columns().len()).map(|i| pg_cell_to_json(row, i)).collect()).collect();
        Ok(QueryResult { columns, rows: rows_out, rows_affected: None, duration_ms: 0, truncated })
    } else {
        let affected = c.execute(sql, &[]).map_err(|e| format!("Error al ejecutar la sentencia: {e}"))?;
        Ok(QueryResult { rows_affected: Some(affected), ..Default::default() })
    }
}

fn mysql_value_to_json(v: &mysql::Value) -> Json {
    match v {
        mysql::Value::NULL => Json::Null,
        mysql::Value::Bytes(b) => match std::str::from_utf8(b) {
            Ok(s) => Json::String(s.to_string()),
            Err(_) => Json::String(format!("\\x{}", b.iter().map(|x| format!("{x:02x}")).collect::<String>())),
        },
        mysql::Value::Int(i) => json!(i),
        mysql::Value::UInt(u) => json!(u),
        mysql::Value::Float(f) => json!(f),
        mysql::Value::Double(d) => json!(d),
        mysql::Value::Date(y, mo, d, h, mi, s, micro) => {
            let frac = if *micro > 0 { format!(".{micro:06}") } else { String::new() };
            Json::String(format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}{frac}"))
        }
        mysql::Value::Time(neg, days, h, mi, s, micro) => {
            let sign = if *neg { "-" } else { "" };
            let total_hours = *days as u64 * 24 + *h as u64;
            let frac = if *micro > 0 { format!(".{micro:06}") } else { String::new() };
            Json::String(format!("{sign}{total_hours:02}:{mi:02}:{s:02}{frac}"))
        }
    }
}

fn run_mysql_query(c: &mut mysql::Conn, sql: &str, is_select: bool) -> Result<QueryResult, String> {
    if is_select {
        let result = c.query_iter(sql).map_err(|e| format!("Error al ejecutar la consulta: {e}"))?;
        let columns: Vec<String> = result.columns().as_ref().iter().map(|col| col.name_str().to_string()).collect();

        let mut rows_out = Vec::new();
        let mut truncated = false;
        for row_result in result {
            let row = row_result.map_err(|e| format!("Error al leer resultados: {e}"))?;
            if rows_out.len() >= MAX_ROWS {
                truncated = true;
                break;
            }
            rows_out.push((0..row.len()).map(|i| row.as_ref(i).map(mysql_value_to_json).unwrap_or(Json::Null)).collect());
        }
        Ok(QueryResult { columns, rows: rows_out, rows_affected: None, duration_ms: 0, truncated })
    } else {
        c.query_iter(sql).map_err(|e| format!("Error al ejecutar la sentencia: {e}"))?;
        Ok(QueryResult { rows_affected: Some(c.affected_rows()), ..Default::default() })
    }
}

#[tauri::command]
pub fn db_run_query(manager: State<'_, DatabaseManager>, db: State<'_, Db>, session_id: String, sql: String) -> Result<QueryResult, String> {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        return Err("La consulta esta vacia.".into());
    }
    let is_select = looks_like_select(trimmed);
    let start = Instant::now();

    let mut map = manager.0.lock().map_err(|_| "Estado de conexiones bloqueado.".to_string())?;
    let conn = map.get_mut(&session_id).ok_or_else(|| "La sesion ya no esta activa. Reconecta.".to_string())?;

    let result = match conn {
        LiveConn::Sqlite(c) => run_sqlite_query(c, trimmed, is_select),
        LiveConn::Postgres(c) => run_postgres_query(c, trimmed, is_select),
        LiveConn::MySql(c) => run_mysql_query(c, trimmed, is_select),
    };
    drop(map);

    let result = result?;
    let duration_ms = start.elapsed().as_millis() as u64;

    // Se audita toda sentencia que no sea de solo lectura — el frontend ya
    // pide confirmacion explicita antes de invocar este comando cuando
    // detecta un verbo destructivo (INSERT/UPDATE/DELETE/DROP/ALTER/...),
    // igual que cualquier otra accion destructiva de KRYPTOS.
    if !is_select {
        record_audit_event(&db, "db_query", &format!("sesion {session_id}"), "ok", Some(trimmed));
    }

    Ok(QueryResult { duration_ms, ..result })
}
