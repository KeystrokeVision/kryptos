use std::fs;
use std::sync::Mutex;

use rusqlite::Connection;

/// Shared SQLite connection, registered as Tauri-managed state. A single
/// `Mutex<Connection>` is plenty for a desktop app's write volume — no
/// connection pool needed.
pub struct Db(pub Mutex<Connection>);

fn db_path() -> Result<std::path::PathBuf, String> {
    let base = dirs::config_dir().ok_or_else(|| "No se pudo determinar el directorio de configuracion del sistema.".to_string())?;
    let dir = base.join("kryptos");
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear el directorio de configuracion: {e}"))?;
    Ok(dir.join("kryptos.db"))
}

/// Opens (creating if needed) the local database and applies schema
/// migrations. Called once at startup; the resulting `Db` is handed to
/// `.manage()` so any command can request it as `State<Db>`.
pub fn init_db() -> Result<Db, String> {
    let path = db_path()?;
    let conn = Connection::open(&path).map_err(|e| format!("No se pudo abrir la base de datos local: {e}"))?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS audit_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp_unix  INTEGER NOT NULL,
            action          TEXT NOT NULL,
            target          TEXT NOT NULL,
            result          TEXT NOT NULL,
            details         TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp_unix DESC);

        CREATE TABLE IF NOT EXISTS app_settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS explorer_favorites (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            path          TEXT NOT NULL UNIQUE,
            label         TEXT NOT NULL,
            added_at_unix INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ssh_profiles (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            label         TEXT NOT NULL,
            host          TEXT NOT NULL,
            port          INTEGER NOT NULL DEFAULT 22,
            username      TEXT NOT NULL,
            auth_method   TEXT NOT NULL,
            key_path      TEXT,
            created_at_unix INTEGER NOT NULL
        );

        -- Trust-on-first-use host key store: the fingerprint seen the
        -- first time we connect to a host:port is pinned here, and every
        -- later connection is checked against it. A mismatch means the
        -- host key changed (server was reinstalled) or a possible
        -- machine-in-the-middle, and the connection is refused either way.
        CREATE TABLE IF NOT EXISTS ssh_known_hosts (
            host_port     TEXT PRIMARY KEY,
            fingerprint   TEXT NOT NULL,
            first_seen_unix INTEGER NOT NULL
        );

        -- Sentinel: the continuous local detection engine. Where audit_log
        -- records what *the user did through KRYPTOS*, these tables record
        -- what *the machine did on its own* — every change Sentinel noticed
        -- between two snapshots, and every rule that fired because of it.
        CREATE TABLE IF NOT EXISTS sentinel_events (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp_unix  INTEGER NOT NULL,
            source          TEXT NOT NULL,
            kind            TEXT NOT NULL,
            subject         TEXT NOT NULL,
            detail          TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sentinel_events_timestamp ON sentinel_events(timestamp_unix DESC);

        CREATE TABLE IF NOT EXISTS sentinel_alerts (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp_unix  INTEGER NOT NULL,
            rule_id         TEXT NOT NULL,
            severity        TEXT NOT NULL,
            title           TEXT NOT NULL,
            detail          TEXT NOT NULL,
            event_id        INTEGER,
            acknowledged    INTEGER NOT NULL DEFAULT 0,
            mitre_id        TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sentinel_alerts_timestamp ON sentinel_alerts(timestamp_unix DESC);

        -- The previous snapshot, as JSON. Sentinel diffs the current state
        -- of the machine against this row on every tick; it is the entire
        -- memory of the engine between runs (and across app restarts).
        CREATE TABLE IF NOT EXISTS sentinel_state (
            key             TEXT PRIMARY KEY,
            value           TEXT NOT NULL,
            updated_at_unix INTEGER NOT NULL
        );

        -- Honeytokens: archivos senuelo desplegados por el usuario. Ver
        -- src-tauri/src/commands/honeytoken.rs. Tocar cualquiera de estos
        -- archivos escribe directo en sentinel_events/sentinel_alerts.
        CREATE TABLE IF NOT EXISTS sentinel_honeytokens (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            path            TEXT NOT NULL UNIQUE,
            label           TEXT NOT NULL,
            created_at_unix INTEGER NOT NULL
        );

        -- Historial de conexiones establecidas hacia hosts remotos, solo
        -- para la deteccion de beaconing (ver sentinel.rs). Se purga cada
        -- tick a las ultimas 24 horas — no es un registro permanente.
        CREATE TABLE IF NOT EXISTS sentinel_connection_history (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp_unix  INTEGER NOT NULL,
            process_name    TEXT NOT NULL,
            pid             INTEGER,
            remote_host     TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_conn_history_lookup ON sentinel_connection_history(process_name, remote_host, timestamp_unix);
        ",
    )
    .map_err(|e| format!("No se pudo preparar el esquema de la base de datos: {e}"))?;

    // Migracion aditiva best-effort: una base de datos creada antes de que
    // `mitre_id` existiera no la tiene, y `CREATE TABLE IF NOT EXISTS` no
    // agrega columnas a una tabla que ya existe. Se ignora el error si la
    // columna ya esta (instalacion nueva, donde el CREATE TABLE de arriba
    // ya la incluyo) — no hay un framework de migraciones en este
    // proyecto todavia, asi que esto se mantiene deliberadamente simple.
    let _ = conn.execute("ALTER TABLE sentinel_alerts ADD COLUMN mitre_id TEXT", []);

    Ok(Db(Mutex::new(conn)))
}
