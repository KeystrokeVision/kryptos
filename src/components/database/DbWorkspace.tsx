import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Editor from "@monaco-editor/react";
import "@/lib/monacoSetup";
import { KRYPTOS_MONACO_THEME } from "@/lib/monacoSetup";
import { Table2, Eye, Key, Play, Loader2, AlertTriangle, Clock, Rows3, ChevronRight, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { DbConnectParams, DbQueryResult, DbTableInfo } from "@/types/database";

interface DbWorkspaceProps {
  sessionId: string;
  params: DbConnectParams;
  label: string;
}

const DESTRUCTIVE_RE = /^\s*(insert|update|delete|drop|alter|truncate|create|replace|grant|revoke)\b/i;

/**
 * Saca comentarios y espacios en blanco del principio de la consulta antes
 * de buscar un verbo destructivo. Sin esto, DESTRUCTIVE_RE (que solo salta
 * \s*) nunca matchea cuando el texto empieza con un comentario SQL — y el
 * editor deja puesto por defecto justamente un comentario de ayuda, asi que
 * un DELETE/DROP escrito debajo del placeholder corria sin pedir
 * confirmacion. Hallazgo real de la auditoria de QA de este modulo (TC09).
 */
function stripLeadingSqlNoise(sql: string): string {
  let s = sql;
  for (let i = 0; i < 50; i++) {
    const withoutSpace = s.replace(/^\s+/, "");
    if (withoutSpace.startsWith("--")) {
      const nl = withoutSpace.indexOf("\n");
      s = nl === -1 ? "" : withoutSpace.slice(nl + 1);
      continue;
    }
    if (withoutSpace.startsWith("/*")) {
      const end = withoutSpace.indexOf("*/");
      s = end === -1 ? "" : withoutSpace.slice(end + 2);
      continue;
    }
    s = withoutSpace;
    break;
  }
  return s;
}

function quoteTableForSelect(table: string) {
  // Alcanza con comillas dobles estándar SQL (Postgres/SQLite las
  // aceptan tal cual; MySQL las acepta si ANSI_QUOTES no cambia el modo
  // por defecto — para el caso comun de nombres simples sin espacios ni
  // comillas esto nunca hace falta, se agregan solo si el nombre las
  // necesita).
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table) ? table : `"${table.replace(/"/g, '""')}"`;
}

export function DbWorkspace({ sessionId, params, label }: DbWorkspaceProps) {
  const [connectState, setConnectState] = useState<"connecting" | "ready" | "error">("connecting");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectInfo, setConnectInfo] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [sql, setSql] = useState("-- Escribe tu consulta SQL y presiona Ctrl+Enter\n");
  const [result, setResult] = useState<DbQueryResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [pendingSql, setPendingSql] = useState<string | null>(null);
  const sqlRef = useRef(sql);
  sqlRef.current = sql;

  useEffect(() => {
    let cancelled = false;
    setConnectState("connecting");
    api
      .dbConnect(sessionId, params)
      .then((info) => {
        if (cancelled) return;
        setConnectInfo(info);
        setConnectState("ready");
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setConnectError(e.message);
        setConnectState("error");
      });
    return () => {
      cancelled = true;
      api.dbDisconnect(sessionId).catch(() => {});
    };
    // sessionId identifica la conexion 1:1 — params solo importa al conectar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const tablesQuery = useQuery({
    queryKey: ["db", "tables", sessionId],
    queryFn: () => api.dbListTables(sessionId),
    enabled: connectState === "ready",
  });

  const columnsQuery = useQuery({
    queryKey: ["db", "columns", sessionId, selectedTable],
    queryFn: () => api.dbListColumns(sessionId, selectedTable as string),
    enabled: connectState === "ready" && !!selectedTable,
  });

  const runMutation = useMutation({
    mutationFn: (query: string) => api.dbRunQuery(sessionId, query),
    onSuccess: (r) => {
      setResult(r);
      setRunError(null);
    },
    onError: (e: Error) => {
      setRunError(e.message);
      setResult(null);
    },
  });

  function executeSql(query: string) {
    const trimmed = query.trim();
    if (!trimmed || runMutation.isPending) return;
    if (DESTRUCTIVE_RE.test(stripLeadingSqlNoise(trimmed))) {
      setPendingSql(trimmed);
      return;
    }
    runMutation.mutate(trimmed);
  }

  function runCurrent() {
    executeSql(sqlRef.current);
  }

  function browseTable(table: DbTableInfo) {
    setSelectedTable(table.name);
    const target = table.schema ? `${table.schema}.${table.name}` : table.name;
    const nextSql = `SELECT * FROM ${quoteTableForSelect(target)} LIMIT 100;`;
    setSql(nextSql);
    executeSql(nextSql);
  }

  return (
    <div className="flex h-full">
      <div className="flex w-56 shrink-0 flex-col border-r border-borderMuted bg-panelAlt">
        <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-borderMuted px-2.5 text-[10px] uppercase tracking-widest text-text-dim">
          <Table2 size={11} /> Tablas
          <button
            onClick={() => tablesQuery.refetch()}
            className="ml-auto text-text-dim hover:text-text"
            aria-label="Actualizar tablas"
          >
            <RefreshCw size={11} className={tablesQuery.isFetching ? "animate-spin" : ""} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {connectState === "connecting" && <p className="px-3 py-3 text-[11px] text-text-dim">Conectando...</p>}
          {connectState === "ready" && (tablesQuery.data ?? []).length === 0 && !tablesQuery.isFetching && (
            <p className="px-3 py-3 text-[11px] text-text-dim">Sin tablas.</p>
          )}
          {(tablesQuery.data ?? []).map((t) => (
            <div key={`${t.schema ?? ""}.${t.name}`}>
              <button
                onClick={() => browseTable(t)}
                className={cn(
                  "flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] hover:bg-overlay/[0.04]",
                  selectedTable === t.name ? "bg-overlay/[0.06] text-text" : "text-text-muted"
                )}
              >
                {t.kind === "view" ? <Eye size={11} className="shrink-0 text-text-dim" /> : <Table2 size={11} className="shrink-0 text-accent-bright" />}
                <span className="truncate">{t.schema ? `${t.schema}.${t.name}` : t.name}</span>
              </button>
              {selectedTable === t.name && (
                <div className="border-t border-borderMuted/50 bg-black/10 py-1">
                  {columnsQuery.isLoading && <p className="px-4 py-1 text-[10px] text-text-dim">Cargando columnas...</p>}
                  {(columnsQuery.data ?? []).map((c) => (
                    <div key={c.name} className="flex items-center gap-1.5 px-4 py-0.5 text-[10px] text-text-dim">
                      {c.is_primary_key ? <Key size={9} className="shrink-0 text-warn" /> : <ChevronRight size={9} className="shrink-0 opacity-0" />}
                      <span className="truncate text-text-muted">{c.name}</span>
                      <span className="ml-auto shrink-0 truncate font-mono opacity-70">{c.data_type}</span>
                      {!c.nullable && <span className="shrink-0 text-[9px] opacity-60">NN</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        {connectInfo && <div className="shrink-0 truncate border-t border-borderMuted px-2.5 py-1.5 text-[10px] text-text-dim" title={connectInfo}>{connectInfo}</div>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {connectState === "error" && (
          <div className="flex items-start gap-2 border-b border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            No se pudo conectar a &quot;{label}&quot;: {connectError}
          </div>
        )}

        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-borderMuted bg-panelAlt px-2.5">
          <button
            onClick={runCurrent}
            disabled={connectState !== "ready" || runMutation.isPending}
            className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[11px] font-medium text-white hover:bg-accent-bright disabled:opacity-40"
          >
            {runMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            Ejecutar
          </button>
          <span className="text-[10px] text-text-dim">Ctrl+Enter</span>
        </div>

        <div className="h-40 shrink-0 border-b border-borderMuted">
          <Editor
            height="100%"
            theme={KRYPTOS_MONACO_THEME}
            language="sql"
            value={sql}
            onChange={(value) => setSql(value ?? "")}
            onMount={(editor, monaco) => {
              editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runCurrent());
            }}
            options={{
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
              minimap: { enabled: false },
              automaticLayout: true,
              scrollBeyondLastLine: false,
              lineNumbers: "on",
              wordWrap: "on",
            }}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {runError && (
            <div className="flex items-start gap-2 border-b border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {runError}
            </div>
          )}

          {result && (
            <div className="flex h-7 shrink-0 items-center gap-3 border-b border-borderMuted bg-panelAlt px-2.5 text-[10px] text-text-dim">
              <span className="flex items-center gap-1">
                <Rows3 size={10} />
                {result.rows_affected !== null ? `${result.rows_affected} filas afectadas` : `${result.rows.length} filas${result.truncated ? ` (limitado a ${result.rows.length})` : ""}`}
              </span>
              <span className="flex items-center gap-1">
                <Clock size={10} />
                {result.duration_ms} ms
              </span>
              {result.truncated && <span className="text-warn">resultado truncado</span>}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            {!result && !runError && (
              <div className="flex h-full items-center justify-center text-[11px] text-text-dim">
                {connectState === "ready" ? "Elegi una tabla o escribi una consulta." : "Esperando conexion..."}
              </div>
            )}
            {result && result.columns.length > 0 && (
              <table className="w-full border-collapse text-left text-[11px]">
                <thead className="sticky top-0 bg-panel text-[10px] uppercase tracking-widest text-text-dim">
                  <tr>
                    {result.columns.map((c, i) => (
                      <th key={`${c}-${i}`} className="whitespace-nowrap border-b border-borderMuted px-3 py-1.5 font-medium">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, ri) => (
                    <tr key={ri} className="border-t border-borderMuted hover:bg-overlay/[0.03]">
                      {row.map((cell, ci) => (
                        <td key={ci} className="max-w-[320px] truncate px-3 py-1 font-mono text-text-muted" title={cell === null ? "NULL" : String(cell)}>
                          {cell === null ? <span className="italic text-text-dim">NULL</span> : String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {result.rows.length === 0 && (
                    <tr>
                      <td colSpan={result.columns.length} className="px-3 py-6 text-center text-text-dim">
                        Sin resultados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {pendingSql && (
        <ConfirmDialog
          title="Ejecutar sentencia destructiva"
          message={`Esta consulta modifica datos o esquema en "${label}": "${pendingSql}". ¿Ejecutarla de todas formas?`}
          confirmLabel="Ejecutar"
          onCancel={() => setPendingSql(null)}
          onConfirm={() => {
            const query = pendingSql;
            setPendingSql(null);
            runMutation.mutate(query);
          }}
        />
      )}
    </div>
  );
}
