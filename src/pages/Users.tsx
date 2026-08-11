import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users as UsersIcon, Search, RefreshCw, UserCheck, UserX, AlertTriangle } from "lucide-react";
import { RelaunchElevatedButton, looksLikePermissionError } from "@/components/layout/RelaunchElevatedButton";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";

export default function UsersPage() {
  const [query, setQuery] = useState("");
  const [showSystem, setShowSystem] = useState(false);

  const { data: users, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["users", "list"],
    queryFn: api.listUsers,
  });

  const filtered = (users ?? [])
    .filter((u) => showSystem || !u.is_system)
    .filter((u) => !query.trim() || u.username.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-borderMuted bg-panelAlt px-3">
        <UsersIcon size={13} className="text-accent-bright" />
        <h2 className="text-xs font-medium text-text">Usuarios</h2>
        <span className="text-[10px] text-text-dim">({filtered.length})</span>

        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} />
            Mostrar cuentas del sistema
          </label>
          <div className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-base px-2">
            <Search size={11} className="text-text-dim" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar..."
              className="h-full w-40 bg-transparent text-[11px] text-text outline-none placeholder:text-text-dim"
            />
          </div>
          <button onClick={() => refetch()} className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-white/[0.06] hover:text-text" aria-label="Actualizar">
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {isError && (
        <div className="flex items-start gap-2 border-b border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{String((error as Error)?.message)}</span>
          {looksLikePermissionError(String((error as Error)?.message ?? "")) && <RelaunchElevatedButton />}
        </div>
      )}

      <p className="border-b border-borderMuted bg-panelAlt/50 px-3 py-1.5 text-[10px] text-text-dim">
        Solo lectura — administrar cuentas (crear, deshabilitar, cambiar contrasena) requiere definir con cuidado un
        modelo de permisos, esta pendiente.
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="p-4 text-xs text-text-dim">Cargando cuentas...</p>
        ) : (
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-panel text-[10px] uppercase tracking-widest text-text-dim">
              <tr>
                <th className="px-3 py-2 font-medium">Usuario</th>
                <th className="px-3 py-2 font-medium">Descripcion</th>
                <th className="w-28 px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 font-medium">Carpeta</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.username} className="border-t border-borderMuted hover:bg-white/[0.03]">
                  <td className="px-3 py-1.5">
                    <span className="text-text">{u.username}</span>
                    {u.is_system && <span className="ml-1.5 rounded-full border border-borderMuted px-1.5 py-0.5 text-[9px] text-text-dim">sistema</span>}
                  </td>
                  <td className="px-3 py-1.5 text-text-dim">{u.description ?? "—"}</td>
                  <td className="px-3 py-1.5">
                    <span className={cn("flex items-center gap-1", u.enabled === false ? "text-text-dim" : "text-ok")}>
                      {u.enabled === false ? <UserX size={11} /> : <UserCheck size={11} />}
                      {u.enabled === false ? "Deshabilitada" : u.enabled === true ? "Activa" : "—"}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 truncate font-mono text-[10px] text-text-dim">{u.home_dir ?? "—"}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-text-dim">
                    Sin resultados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
