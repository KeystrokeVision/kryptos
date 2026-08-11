use std::path::Path;

use git2::{DiffFormat, DiffOptions, Repository, Status, StatusOptions};
use serde::Serialize;

fn open_repo(path: &str) -> Result<Repository, String> {
    Repository::open(path).map_err(|e| format!("'{path}' no es un repositorio Git valido: {e}"))
}

#[derive(Serialize)]
pub struct RepoInfo {
    pub path: String,
    pub current_branch: Option<String>,
    pub is_clean: bool,
    pub head_commit: Option<String>,
}

/// Opens a repo and reports its basic state — used when the user points
/// the Git module at a folder, to confirm it's actually a repo and show
/// the current branch before anything else loads.
#[tauri::command]
pub fn get_repo_info(path: String) -> Result<RepoInfo, String> {
    let repo = open_repo(&path)?;
    let current_branch = repo.head().ok().and_then(|h| h.shorthand().map(|s| s.to_string()));
    let head_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok()).map(|c| c.id().to_string());

    let mut opts = StatusOptions::new();
    opts.include_untracked(true);
    let is_clean = repo.statuses(Some(&mut opts)).map(|s| s.is_empty()).unwrap_or(false);

    Ok(RepoInfo { path, current_branch, is_clean, head_commit })
}

// ---------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------

#[derive(Serialize)]
pub struct FileStatus {
    pub path: String,
    pub staged: bool,
    pub kind: String, // "new" | "modified" | "deleted" | "renamed" | "typechange" | "conflicted"
}

fn status_kind(status: Status, staged: bool) -> Option<&'static str> {
    if staged {
        if status.is_index_new() {
            return Some("new");
        }
        if status.is_index_modified() {
            return Some("modified");
        }
        if status.is_index_deleted() {
            return Some("deleted");
        }
        if status.is_index_renamed() {
            return Some("renamed");
        }
        if status.is_index_typechange() {
            return Some("typechange");
        }
    } else {
        if status.is_wt_new() {
            return Some("new");
        }
        if status.is_wt_modified() {
            return Some("modified");
        }
        if status.is_wt_deleted() {
            return Some("deleted");
        }
        if status.is_wt_renamed() {
            return Some("renamed");
        }
        if status.is_wt_typechange() {
            return Some("typechange");
        }
    }
    if status.is_conflicted() {
        return Some("conflicted");
    }
    None
}

/// Lists changed files split into staged (index vs HEAD) and unstaged
/// (workdir vs index), plus untracked files — the same three buckets
/// `git status` shows.
#[tauri::command]
pub fn get_repo_status(path: String) -> Result<Vec<FileStatus>, String> {
    let repo = open_repo(&path)?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true);
    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| format!("No se pudo obtener el estado del repositorio: {e}"))?;

    let mut out = Vec::new();
    for entry in statuses.iter() {
        let Some(file_path) = entry.path() else { continue };
        let status = entry.status();

        if let Some(kind) = status_kind(status, true) {
            out.push(FileStatus { path: file_path.to_string(), staged: true, kind: kind.to_string() });
        }
        if let Some(kind) = status_kind(status, false) {
            out.push(FileStatus { path: file_path.to_string(), staged: false, kind: kind.to_string() });
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------

#[derive(Serialize)]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub author_name: String,
    pub author_email: String,
    pub timestamp_unix: i64,
    pub summary: String,
}

/// Walks commit history starting at HEAD, newest first.
#[tauri::command]
pub fn get_commit_log(path: String, limit: Option<u32>) -> Result<Vec<CommitInfo>, String> {
    let repo = open_repo(&path)?;
    let mut revwalk = repo.revwalk().map_err(|e| format!("No se pudo recorrer el historial: {e}"))?;
    revwalk.push_head().map_err(|e| format!("El repositorio no tiene commits todavia: {e}"))?;

    let limit = limit.unwrap_or(100).min(1000) as usize;
    let mut commits = Vec::new();
    for oid in revwalk.take(limit) {
        let oid = oid.map_err(|e| format!("No se pudo leer un commit: {e}"))?;
        let commit = repo.find_commit(oid).map_err(|e| format!("No se pudo leer el commit {oid}: {e}"))?;
        let author = commit.author();
        commits.push(CommitInfo {
            hash: oid.to_string(),
            short_hash: oid.to_string().chars().take(7).collect(),
            author_name: author.name().unwrap_or("desconocido").to_string(),
            author_email: author.email().unwrap_or("").to_string(),
            timestamp_unix: commit.time().seconds(),
            summary: commit.summary().unwrap_or("").to_string(),
        });
    }
    Ok(commits)
}

// ---------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------

#[derive(Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
}

#[tauri::command]
pub fn list_branches(path: String) -> Result<Vec<BranchInfo>, String> {
    let repo = open_repo(&path)?;
    let branches = repo.branches(Some(git2::BranchType::Local)).map_err(|e| format!("No se pudo listar las ramas: {e}"))?;

    let mut out = Vec::new();
    for b in branches {
        let (branch, _) = b.map_err(|e| format!("No se pudo leer una rama: {e}"))?;
        if let Some(name) = branch.name().map_err(|e| format!("Nombre de rama invalido: {e}"))? {
            out.push(BranchInfo { name: name.to_string(), is_head: branch.is_head() });
        }
    }
    Ok(out)
}

/// Checks out an existing local branch. Refuses (rather than force-discarding
/// changes) if the working tree has uncommitted modifications that the
/// checkout would clobber — git2 surfaces that as an error, which we just
/// pass through with a clearer message.
#[tauri::command]
pub fn checkout_branch(path: String, branch_name: String) -> Result<(), String> {
    let repo = open_repo(&path)?;
    let branch_ref = format!("refs/heads/{branch_name}");
    let obj = repo.revparse_single(&branch_ref).map_err(|e| format!("No se encontro la rama '{branch_name}': {e}"))?;

    repo.checkout_tree(&obj, None).map_err(|e| {
        format!("No se pudo cambiar a '{branch_name}' — probablemente hay cambios sin confirmar que se perderian: {e}")
    })?;
    repo.set_head(&branch_ref).map_err(|e| format!("No se pudo actualizar HEAD a '{branch_name}': {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------

/// Unified diff text for one file — staged (index vs HEAD) or unstaged
/// (workdir vs index), matching the two panes of `get_repo_status`.
#[tauri::command]
pub fn get_file_diff(path: String, file_path: String, staged: bool) -> Result<String, String> {
    let repo = open_repo(&path)?;
    let mut opts = DiffOptions::new();
    opts.pathspec(&file_path);

    let diff = if staged {
        let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))
    } else {
        repo.diff_index_to_workdir(None, Some(&mut opts))
    }
    .map_err(|e| format!("No se pudo generar el diff: {e}"))?;

    let mut buf = String::new();
    diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
        let origin = line.origin();
        if origin == '+' || origin == '-' || origin == ' ' {
            buf.push(origin);
        }
        buf.push_str(&String::from_utf8_lossy(line.content()));
        true
    })
    .map_err(|e| format!("No se pudo generar el diff: {e}"))?;

    Ok(buf)
}

// ---------------------------------------------------------------------
// Stage / unstage / commit
// ---------------------------------------------------------------------

#[tauri::command]
pub fn stage_file(path: String, file_path: String) -> Result<(), String> {
    let repo = open_repo(&path)?;
    let mut index = repo.index().map_err(|e| format!("No se pudo abrir el indice: {e}"))?;
    let target = Path::new(&file_path);

    if target.exists() {
        index.add_path(target).map_err(|e| format!("No se pudo agregar '{file_path}': {e}"))?;
    } else {
        index.remove_path(target).map_err(|e| format!("No se pudo preparar la eliminacion de '{file_path}': {e}"))?;
    }
    index.write().map_err(|e| format!("No se pudo guardar el indice: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn unstage_file(path: String, file_path: String) -> Result<(), String> {
    let repo = open_repo(&path)?;
    let head = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    match head {
        Some(commit) => {
            repo.reset_default(Some(commit.as_object()), [file_path.as_str()])
                .map_err(|e| format!("No se pudo quitar '{file_path}' del stage: {e}"))?;
        }
        None => {
            let mut index = repo.index().map_err(|e| format!("No se pudo abrir el indice: {e}"))?;
            index.remove_path(Path::new(&file_path)).map_err(|e| format!("No se pudo quitar '{file_path}' del stage: {e}"))?;
            index.write().map_err(|e| format!("No se pudo guardar el indice: {e}"))?;
        }
    }
    Ok(())
}

/// Commits whatever is currently staged. Uses the repo's own configured
/// user.name/user.email (git config); if those aren't set, this fails with
/// a clear message rather than silently committing as "unknown".
#[tauri::command]
pub fn commit_changes(path: String, message: String) -> Result<String, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("El mensaje de commit no puede estar vacio.".into());
    }
    let repo = open_repo(&path)?;

    let signature = repo.signature().map_err(|_| {
        "No hay 'user.name'/'user.email' configurados en este repositorio. Configuralos con 'git config user.name' y 'git config user.email'.".to_string()
    })?;

    let mut index = repo.index().map_err(|e| format!("No se pudo abrir el indice: {e}"))?;
    let tree_oid = index.write_tree().map_err(|e| format!("No se pudo preparar el commit: {e}"))?;
    let tree = repo.find_tree(tree_oid).map_err(|e| format!("No se pudo leer el arbol del commit: {e}"))?;

    let parent_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent_commit.iter().collect();

    let oid = repo
        .commit(Some("HEAD"), &signature, &signature, message, &tree, &parents)
        .map_err(|e| format!("No se pudo crear el commit: {e}"))?;

    Ok(oid.to_string())
}

/// A quick way to sanity-check a folder before opening it in the Git
/// module's UI.
#[tauri::command]
pub fn is_git_repository(path: String) -> bool {
    Repository::open(&path).is_ok()
}

// ---------------------------------------------------------------------
// Push / fetch / pull (SSH only — see Cargo.toml for why HTTPS isn't
// enabled: it would pull in a vendored OpenSSL build that needs Perl,
// which we can't assume is present on the user's machine. SSH remotes
// cover the overwhelming majority of real-world git usage.)
// ---------------------------------------------------------------------

/// Builds the credentials callback used by push/fetch: tries an explicit
/// key path first (if the user gave one), then a running ssh-agent, then
/// falls back to the default `~/.ssh/id_ed25519` / `~/.ssh/id_rsa`
/// locations — the same order a real `git` CLI effectively ends up using.
fn build_credentials_callback(key_path: Option<String>, passphrase: Option<String>) -> git2::RemoteCallbacks<'static> {
    let mut callbacks = git2::RemoteCallbacks::new();
    callbacks.credentials(move |_url, username_from_url, allowed_types| {
        let user = username_from_url.unwrap_or("git");

        if allowed_types.contains(git2::CredentialType::SSH_KEY) {
            if let Some(ref key_path) = key_path {
                return git2::Cred::ssh_key(user, None, Path::new(key_path), passphrase.as_deref());
            }
            if let Ok(cred) = git2::Cred::ssh_key_from_agent(user) {
                return Ok(cred);
            }
            if let Some(home) = dirs::home_dir() {
                for name in ["id_ed25519", "id_rsa"] {
                    let candidate = home.join(".ssh").join(name);
                    if candidate.exists() {
                        return git2::Cred::ssh_key(user, None, &candidate, passphrase.as_deref());
                    }
                }
            }
        }
        Err(git2::Error::from_str("No se encontraron credenciales SSH validas (ni llave especificada, ni ssh-agent, ni llave por defecto)."))
    });
    callbacks
}

/// Pushes a local branch to a remote. `key_path`/`passphrase` are optional
/// — if omitted, falls back to ssh-agent or the default key locations.
#[tauri::command]
pub fn push_to_remote(path: String, remote_name: String, branch: String, key_path: Option<String>, passphrase: Option<String>) -> Result<(), String> {
    let repo = open_repo(&path)?;
    let mut remote = repo.find_remote(&remote_name).map_err(|e| format!("No se encontro el remoto '{remote_name}': {e}"))?;

    let callbacks = build_credentials_callback(key_path, passphrase);
    let mut push_options = git2::PushOptions::new();
    push_options.remote_callbacks(callbacks);

    let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
    remote
        .push(&[refspec.as_str()], Some(&mut push_options))
        .map_err(|e| format!("No se pudo hacer push a '{remote_name}': {e}"))
}

/// Fetches from a remote without touching the working tree or local
/// branches — the "look but don't merge yet" half of a pull.
#[tauri::command]
pub fn fetch_from_remote(path: String, remote_name: String, branch: String, key_path: Option<String>, passphrase: Option<String>) -> Result<(), String> {
    let repo = open_repo(&path)?;
    let mut remote = repo.find_remote(&remote_name).map_err(|e| format!("No se encontro el remoto '{remote_name}': {e}"))?;

    let callbacks = build_credentials_callback(key_path, passphrase);
    let mut fetch_options = git2::FetchOptions::new();
    fetch_options.remote_callbacks(callbacks).download_tags(git2::AutotagOption::All);

    remote.fetch(&[branch.as_str()], Some(&mut fetch_options), None).map_err(|e| format!("No se pudo hacer fetch de '{remote_name}': {e}"))
}

/// Fetches then fast-forwards the local branch if possible. Deliberately
/// refuses (rather than auto-merging) when the branches have diverged —
/// validated against a real repo that was genuinely behind its remote,
/// confirmed both by the returned commit id and by `git log`/`git status`
/// agreeing the working tree ended up clean and up to date.
#[tauri::command]
pub fn pull_from_remote(path: String, remote_name: String, branch: String, key_path: Option<String>, passphrase: Option<String>) -> Result<String, String> {
    let repo = open_repo(&path)?;
    {
        let mut remote = repo.find_remote(&remote_name).map_err(|e| format!("No se encontro el remoto '{remote_name}': {e}"))?;
        let callbacks = build_credentials_callback(key_path, passphrase);
        let mut fetch_options = git2::FetchOptions::new();
        fetch_options.remote_callbacks(callbacks).download_tags(git2::AutotagOption::All);
        remote
            .fetch(&[branch.as_str()], Some(&mut fetch_options), None)
            .map_err(|e| format!("No se pudo hacer fetch de '{remote_name}': {e}"))?;
    }

    let fetch_head = repo.find_reference("FETCH_HEAD").map_err(|e| format!("No se encontro FETCH_HEAD: {e}"))?;
    let fetch_commit = repo.reference_to_annotated_commit(&fetch_head).map_err(|e| format!("No se pudo leer FETCH_HEAD: {e}"))?;
    let analysis = repo.merge_analysis(&[&fetch_commit]).map_err(|e| format!("No se pudo analizar el merge: {e}"))?;

    if analysis.0.is_up_to_date() {
        return Ok("up_to_date".to_string());
    }
    if analysis.0.is_fast_forward() {
        let refname = format!("refs/heads/{branch}");
        let mut reference = repo.find_reference(&refname).map_err(|e| format!("No se encontro la rama local '{branch}': {e}"))?;
        reference
            .set_target(fetch_commit.id(), "kryptos: fast-forward pull")
            .map_err(|e| format!("No se pudo mover la rama: {e}"))?;
        repo.set_head(&refname).map_err(|e| format!("No se pudo actualizar HEAD: {e}"))?;
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
            .map_err(|e| format!("No se pudo actualizar los archivos: {e}"))?;
        return Ok(fetch_commit.id().to_string());
    }

    Err("Las ramas divergieron — no se puede hacer fast-forward. Resuelve el merge manualmente (esto es intencional: KRYPTOS no hace merges automaticos que puedan perder cambios).".into())
}
