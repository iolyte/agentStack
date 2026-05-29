use serde::{Deserialize, Serialize};
use serde_json::json;
use std::env;
use std::fs::{self, File};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

const RUNTIME_ENV_TEMPLATE: &str = include_str!("../../runtime-template/.env.template");
const RUNTIME_COMPOSE_TEMPLATE: &str = include_str!("../../runtime-template/docker-compose.desktop.yml");
const RUNTIME_NGINX_TEMPLATE: &str = include_str!("../../runtime-template/nginx.conf");
const UI_URL: &str = "http://localhost";
const MISSION_CONTROL_FALLBACK_URL: &str = "http://localhost:4000";
const ACCESS_GUIDE_URL: &str = "https://one.dash.cloudflare.com/";

#[cfg(target_arch = "aarch64")]
const CLOUDFLARED_TARGET: &str = "aarch64-apple-darwin";
#[cfg(target_arch = "x86_64")]
const CLOUDFLARED_TARGET: &str = "x86_64-apple-darwin";

#[derive(Clone, Copy)]
enum LauncherMode {
    Repo,
    Runtime,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct RemoteAccessStatus {
    cloudflare_available: bool,
    cloudflare_source: String,
    cloudflare_version: Option<String>,
    sidecar_configured: bool,
    sidecar_provisioned: bool,
    tunnel_configured: bool,
    tunnel_running: bool,
    tunnel_name: Option<String>,
    tunnel_id: Option<String>,
    hostname: Option<String>,
    access_email: Option<String>,
    access_confirmed: bool,
    remote_url: Option<String>,
    access_guide_url: String,
    config_path: Option<String>,
    last_started_at: Option<String>,
    last_stopped_at: Option<String>,
    last_output: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LauncherStatus {
    mode: &'static str,
    docker_installed: bool,
    docker_running: bool,
    repo_root: Option<String>,
    runtime_root: String,
    env_path: String,
    env_exists: bool,
    env_ready: bool,
    ui_reachable: bool,
    running_services: Vec<String>,
    output: String,
    remote_access: RemoteAccessStatus,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudflareLoginResult {
    status: LauncherStatus,
    cert_pem: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudflareTunnelResult {
    status: LauncherStatus,
    credentials_json: String,
}

#[derive(Default)]
struct CommandResult {
    stdout: String,
    stderr: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct RemoteAccessMetadata {
    tunnel_name: Option<String>,
    tunnel_id: Option<String>,
    hostname: Option<String>,
    access_email: Option<String>,
    access_confirmed: bool,
    config_path: Option<String>,
    last_started_at: Option<String>,
    last_stopped_at: Option<String>,
    last_output: Option<String>,
}

struct ManagedRemoteAccess {
    child: Child,
    log_path: PathBuf,
    credentials_path: PathBuf,
    config_path: PathBuf,
}

#[derive(Default)]
struct LauncherState {
    remote_access: Mutex<Option<ManagedRemoteAccess>>,
}

struct ResolvedBinary {
    path: PathBuf,
    source: &'static str,
    version: Option<String>,
    sidecar_provisioned: bool,
    usable: bool,
}

fn detect_repo_root() -> Option<PathBuf> {
    let candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .ok()?;

    if candidate.join("scripts/agentstack").exists() || candidate.join("scripts/clawstack").exists() {
        Some(candidate)
    } else {
        None
    }
}

fn runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())
}

fn remote_root(runtime_root: &Path) -> PathBuf {
    runtime_root.join("cloudflare")
}

fn materialized_cloudflare_dir(runtime_root: &Path) -> PathBuf {
    remote_root(runtime_root).join("materialized")
}

fn bootstrap_cloudflare_home(runtime_root: &Path) -> PathBuf {
    remote_root(runtime_root).join("bootstrap-home")
}

fn bootstrap_cloudflare_dir(runtime_root: &Path) -> PathBuf {
    bootstrap_cloudflare_home(runtime_root).join(".cloudflared")
}

fn remote_access_metadata_path(runtime_root: &Path) -> PathBuf {
    remote_root(runtime_root).join("remote-access.json")
}

fn remote_access_log_path(runtime_root: &Path) -> PathBuf {
    remote_root(runtime_root).join("cloudflared.log")
}

fn remote_access_pid_path(runtime_root: &Path) -> PathBuf {
    remote_root(runtime_root).join("cloudflared.pid")
}

fn reset_dir(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())?;
    }

    fs::create_dir_all(path).map_err(|error| error.to_string())
}

fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn write_if_changed(path: &Path, contents: &str) -> Result<(), String> {
    if path.exists() {
        let existing = fs::read_to_string(path).map_err(|error| error.to_string())?;

        if existing == contents {
            return Ok(());
        }
    }

    fs::write(path, contents).map_err(|error| error.to_string())
}

fn write_private_file(path: &Path, contents: &str) -> Result<(), String> {
    fs::write(path, contents).map_err(|error| error.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn ensure_runtime_bundle(app: &AppHandle) -> Result<PathBuf, String> {
    let root = runtime_root(app)?;

    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    for relative in [
        "data/openclaw/config",
        "data/openclaw/workspace",
        "data/postgres",
        "data/redis",
        "data/qdrant",
        "cloudflare",
        "cloudflare/materialized",
    ] {
        fs::create_dir_all(root.join(relative)).map_err(|error| error.to_string())?;
    }

    write_if_changed(&root.join("docker-compose.desktop.yml"), RUNTIME_COMPOSE_TEMPLATE)?;
    write_if_changed(&root.join(".env.template"), RUNTIME_ENV_TEMPLATE)?;
    write_if_changed(&root.join("nginx.conf"), RUNTIME_NGINX_TEMPLATE)?;

    let env_path = root.join(".env");
    if !env_path.exists() {
        write_if_changed(&env_path, RUNTIME_ENV_TEMPLATE)?;
    }

    let manifest = json!({
        "productName": "agentStack",
        "version": env!("CARGO_PKG_VERSION"),
        "preparedAt": unix_timestamp_string(),
        "mode": if detect_repo_root().is_some() { "repo" } else { "runtime" }
    });

    write_if_changed(
        &root.join("manifest.json"),
        &serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())?,
    )?;

    Ok(root)
}

fn unix_timestamp_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

fn active_mode() -> LauncherMode {
    if detect_repo_root().is_some() {
        LauncherMode::Repo
    } else {
        LauncherMode::Runtime
    }
}

fn env_path_for(mode: LauncherMode, runtime_root: &Path) -> PathBuf {
    match mode {
        LauncherMode::Repo => detect_repo_root()
            .unwrap_or_else(|| runtime_root.to_path_buf())
            .join(".env"),
        LauncherMode::Runtime => runtime_root.join(".env"),
    }
}

fn env_is_ready(path: &Path) -> bool {
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(_) => return false,
    };

    for required_key in ["OPENROUTER_API_KEY", "POSTGRES_PASSWORD"] {
        let needle = format!("{required_key}=");

        let Some(line) = contents.lines().find(|line| line.starts_with(&needle)) else {
            return false;
        };

        let value = line.split_once('=').map(|(_, value)| value.trim()).unwrap_or_default();
        if value.is_empty() {
            return false;
        }
    }

    true
}

fn port_is_open(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&address, Duration::from_millis(350)).is_ok()
}

fn normalize_output(output: &std::process::Output) -> CommandResult {
    CommandResult {
        stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
    }
}

fn run_command(
    program: &Path,
    args: &[&str],
    working_dir: &Path,
    env_overrides: &[(&str, String)],
) -> Result<CommandResult, String> {
    let mut command = Command::new(program);
    command.args(args).current_dir(working_dir);

    for (key, value) in env_overrides {
        command.env(key, value);
    }

    let output = command
        .output()
        .map_err(|error| format!("Failed to run {}: {error}", program.display()))?;

    let result = normalize_output(&output);

    if output.status.success() {
        Ok(result)
    } else {
        let combined = format_output(&result);
        Err(if combined.is_empty() {
            format!("{} exited with status {}", program.display(), output.status)
        } else {
            combined
        })
    }
}

fn probe_command(program: &Path, args: &[&str], env_overrides: &[(&str, String)]) -> Option<CommandResult> {
    let mut command = Command::new(program);
    command.args(args);

    for (key, value) in env_overrides {
        command.env(key, value);
    }

    command.output().ok().map(|output| normalize_output(&output))
}

fn format_output(result: &CommandResult) -> String {
    match (result.stdout.is_empty(), result.stderr.is_empty()) {
        (false, false) => format!("{}\n\n{}", result.stdout, result.stderr),
        (false, true) => result.stdout.clone(),
        (true, false) => result.stderr.clone(),
        (true, true) => String::new(),
    }
}

fn candidate_binary_paths(name: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(path_var) = env::var_os("PATH") {
        for dir in env::split_paths(&path_var) {
            candidates.push(dir.join(name));
        }
    }

    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
        candidates.push(PathBuf::from(dir).join(name));
    }

    candidates
}

fn resolve_system_binary(name: &str) -> Option<PathBuf> {
    candidate_binary_paths(name)
        .into_iter()
        .find(|path| path.exists())
}

fn docker_binary() -> Option<PathBuf> {
    resolve_system_binary("docker")
}

fn bash_binary() -> PathBuf {
    resolve_system_binary("bash").unwrap_or_else(|| PathBuf::from("/bin/bash"))
}

fn cloudflared_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let file_name = format!("cloudflared-{CLOUDFLARED_TARGET}");
    let mut candidates = Vec::new();

    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.push(parent.join("cloudflared"));
            candidates.push(parent.join(&file_name));
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("cloudflared"));
        candidates.push(resource_dir.join(&file_name));
        candidates.push(resource_dir.join("binaries").join(&file_name));
    }

    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join("cloudflared"));
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join(file_name));
    candidates
}

fn detect_cloudflared_binary(app: &AppHandle) -> Option<ResolvedBinary> {
    let bundled_candidates = cloudflared_candidates(app);

    for candidate in bundled_candidates {
        if !candidate.exists() {
            continue;
        }

        let version_probe = probe_command(&candidate, &["--version"], &[]);
        let version = version_probe
            .as_ref()
            .map(format_output)
            .filter(|value| !value.trim().is_empty());
        let provisioned = version
            .as_ref()
            .map(|value| !value.to_lowercase().contains("placeholder sidecar"))
            .unwrap_or(false);

        if provisioned {
            return Some(ResolvedBinary {
                path: candidate,
                source: "bundled",
                version,
                sidecar_provisioned: true,
                usable: true,
            });
        }

        return Some(ResolvedBinary {
            path: candidate,
            source: "bundled-placeholder",
            version,
            sidecar_provisioned: false,
            usable: false,
        });
    }

    let system_path = resolve_system_binary("cloudflared")?;
    let version = probe_command(&system_path, &["--version"], &[])
        .map(|result| format_output(&result))
        .filter(|value| !value.trim().is_empty());

    Some(ResolvedBinary {
        path: system_path,
        source: "system",
        version,
        sidecar_provisioned: false,
        usable: true,
    })
}

fn require_cloudflared_binary(app: &AppHandle) -> Result<ResolvedBinary, String> {
    let Some(binary) = detect_cloudflared_binary(app) else {
        return Err(
            "Cloudflare remote access is not available yet. Provision the bundled cloudflared sidecar or install cloudflared in /opt/homebrew/bin or /usr/local/bin."
                .to_string(),
        );
    };

    if binary.usable {
        Ok(binary)
    } else {
        Err(
            "The bundled cloudflared sidecar is still a placeholder. Run the beta packaging workflow or install cloudflared locally before enabling remote access."
                .to_string(),
        )
    }
}

fn list_running_services(mode: LauncherMode, runtime_root: &Path) -> Vec<String> {
    let Some(docker) = docker_binary() else {
        return Vec::new();
    };

    let command_result = match mode {
        LauncherMode::Repo => detect_repo_root()
            .ok_or_else(|| "Repo root not available".to_string())
            .and_then(|repo_root| {
                run_command(
                    &docker,
                    &["compose", "-f", "docker-compose.yml", "ps", "--status", "running", "--services"],
                    &repo_root,
                    &[],
                )
            }),
        LauncherMode::Runtime => run_command(
            &docker,
            &[
                "compose",
                "--env-file",
                ".env",
                "-f",
                "docker-compose.desktop.yml",
                "ps",
                "--status",
                "running",
                "--services",
            ],
            runtime_root,
            &[],
        ),
    };

    command_result
        .ok()
        .map(|result| {
            result
                .stdout
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn load_remote_access_metadata(runtime_root: &Path) -> Result<RemoteAccessMetadata, String> {
    let path = remote_access_metadata_path(runtime_root);
    if !path.exists() {
        return Ok(RemoteAccessMetadata::default());
    }

    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents).map_err(|error| error.to_string())
}

fn save_remote_access_metadata(runtime_root: &Path, metadata: &RemoteAccessMetadata) -> Result<(), String> {
    let path = remote_access_metadata_path(runtime_root);
    let contents = serde_json::to_string_pretty(metadata).map_err(|error| error.to_string())?;
    write_if_changed(&path, &contents)
}

fn clear_remote_access_metadata(runtime_root: &Path) -> Result<(), String> {
    remove_file_if_exists(&remote_access_metadata_path(runtime_root))
}

fn cleanup_materialized_remote_access(runtime_root: &Path) -> Result<(), String> {
    let materialized = materialized_cloudflare_dir(runtime_root);
    if materialized.exists() {
        fs::remove_dir_all(&materialized).map_err(|error| error.to_string())?;
    }

    fs::create_dir_all(&materialized).map_err(|error| error.to_string())?;
    remove_file_if_exists(&remote_access_pid_path(runtime_root))
}

fn read_log_tail(path: &Path) -> String {
    let Ok(contents) = fs::read_to_string(path) else {
        return String::new();
    };

    let mut lines: Vec<&str> = contents.lines().rev().take(12).collect();
    lines.reverse();
    lines.join("\n")
}

fn reconcile_remote_access(state: &LauncherState, runtime_root: &Path) {
    let mut guard = match state.remote_access.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };

    let finished = match guard.as_mut() {
        Some(managed) => match managed.child.try_wait() {
            Ok(Some(_)) => true,
            Ok(None) => false,
            Err(_) => true,
        },
        None => false,
    };

    if finished {
        guard.take();
        let _ = cleanup_materialized_remote_access(runtime_root);
    }
}

fn build_cloudflare_config(tunnel_id: &str, hostname: &str, credentials_path: &Path) -> String {
    format!(
        "tunnel: {tunnel_id}\ncredentials-file: {}\ningress:\n  - hostname: {hostname}\n    service: http://127.0.0.1:80\n  - service: http_status:404\n",
        credentials_path.display()
    )
}

fn validate_tunnel_name(tunnel_name: &str) -> Result<(), String> {
    let trimmed = tunnel_name.trim();
    if trimmed.is_empty() {
        return Err("Tunnel name is required.".to_string());
    }

    if trimmed.len() > 63 {
        return Err("Tunnel name must be 63 characters or fewer.".to_string());
    }

    if !trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("Tunnel name can only contain letters, numbers, and dashes.".to_string());
    }

    Ok(())
}

fn validate_hostname(hostname: &str) -> Result<(), String> {
    let trimmed = hostname.trim().to_lowercase();
    if trimmed.is_empty() {
        return Err("A public hostname is required.".to_string());
    }

    if !trimmed.contains('.') {
        return Err("Hostname must include a domain, for example beta.example.com.".to_string());
    }

    if !trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '.')
    {
        return Err("Hostname can only contain letters, numbers, dots, and dashes.".to_string());
    }

    Ok(())
}

fn validate_access_email(access_email: Option<&str>) -> Result<(), String> {
    let Some(email) = access_email.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(());
    };

    if !email.contains('@') || !email.split('@').nth(1).unwrap_or_default().contains('.') {
        return Err("Access email must be a valid email address.".to_string());
    }

    Ok(())
}

fn extract_tunnel_uuid(output: &str) -> Option<String> {
    for token in output.split_whitespace() {
        let candidate = token.trim_matches(|character: char| !character.is_ascii_hexdigit() && character != '-');
        if candidate.len() != 36 {
            continue;
        }

        let bytes = candidate.as_bytes();
        if bytes.get(8) != Some(&b'-')
            || bytes.get(13) != Some(&b'-')
            || bytes.get(18) != Some(&b'-')
            || bytes.get(23) != Some(&b'-')
        {
            continue;
        }

        if candidate
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-')
        {
            return Some(candidate.to_string());
        }
    }

    None
}

fn remote_access_status(app: &AppHandle, state: &LauncherState, runtime_root: &Path) -> RemoteAccessStatus {
    reconcile_remote_access(state, runtime_root);

    let metadata = load_remote_access_metadata(runtime_root).unwrap_or_default();
    let binary = detect_cloudflared_binary(app);
    let tunnel_running = state
        .remote_access
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|_| true))
        .unwrap_or(false);
    let log_path = remote_access_log_path(runtime_root);

    RemoteAccessStatus {
        cloudflare_available: binary.as_ref().map(|binary| binary.usable).unwrap_or(false),
        cloudflare_source: binary
            .as_ref()
            .map(|binary| binary.source.to_string())
            .unwrap_or_else(|| "missing".to_string()),
        cloudflare_version: binary.and_then(|binary| binary.version),
        sidecar_configured: cloudflared_candidates(app).iter().any(|path| path.exists()),
        sidecar_provisioned: detect_cloudflared_binary(app)
            .map(|binary| binary.sidecar_provisioned)
            .unwrap_or(false),
        tunnel_configured: metadata.tunnel_id.is_some() && metadata.hostname.is_some(),
        tunnel_running,
        tunnel_name: metadata.tunnel_name.clone(),
        tunnel_id: metadata.tunnel_id.clone(),
        hostname: metadata.hostname.clone(),
        access_email: metadata.access_email.clone(),
        access_confirmed: metadata.access_confirmed,
        remote_url: metadata.hostname.map(|hostname| format!("https://{hostname}")),
        access_guide_url: ACCESS_GUIDE_URL.to_string(),
        config_path: metadata.config_path.clone(),
        last_started_at: metadata.last_started_at.clone(),
        last_stopped_at: metadata.last_stopped_at.clone(),
        last_output: metadata
            .last_output
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| read_log_tail(&log_path)),
    }
}

fn build_status(app: &AppHandle, state: &LauncherState, output: impl Into<String>) -> Result<LauncherStatus, String> {
    let runtime_root = ensure_runtime_bundle(app)?;
    let mode = active_mode();
    let repo_root = detect_repo_root();
    let env_path = env_path_for(mode, &runtime_root);
    let docker = docker_binary();

    let docker_installed = docker.is_some();
    let docker_running = docker
        .as_ref()
        .and_then(|binary| Command::new(binary).arg("info").output().ok())
        .map(|result| result.status.success())
        .unwrap_or(false);

    Ok(LauncherStatus {
        mode: match mode {
            LauncherMode::Repo => "repo",
            LauncherMode::Runtime => "runtime",
        },
        docker_installed,
        docker_running,
        repo_root: repo_root.map(|path| path.display().to_string()),
        runtime_root: runtime_root.display().to_string(),
        env_path: env_path.display().to_string(),
        env_exists: env_path.exists(),
        env_ready: env_is_ready(&env_path),
        ui_reachable: port_is_open(80) || port_is_open(4000),
        running_services: list_running_services(mode, &runtime_root),
        output: output.into(),
        remote_access: remote_access_status(app, state, &runtime_root),
    })
}

fn start_command_for(mode: LauncherMode) -> (&'static str, Vec<&'static str>, PathBuf) {
    match mode {
        LauncherMode::Repo => {
            let repo_root = detect_repo_root().expect("repo mode requires a repo root");
            ("bash", vec!["scripts/agentstack", "start"], repo_root)
        }
        LauncherMode::Runtime => (
            "docker",
            vec![
                "compose",
                "--env-file",
                ".env",
                "-f",
                "docker-compose.desktop.yml",
                "up",
                "-d",
            ],
            PathBuf::new(),
        ),
    }
}

fn stop_command_for(mode: LauncherMode) -> (&'static str, Vec<&'static str>, PathBuf) {
    match mode {
        LauncherMode::Repo => {
            let repo_root = detect_repo_root().expect("repo mode requires a repo root");
            ("bash", vec!["scripts/agentstack", "stop"], repo_root)
        }
        LauncherMode::Runtime => (
            "docker",
            vec![
                "compose",
                "--env-file",
                ".env",
                "-f",
                "docker-compose.desktop.yml",
                "down",
            ],
            PathBuf::new(),
        ),
    }
}

fn resolve_program(program: &str) -> Result<PathBuf, String> {
    match program {
        "bash" => Ok(bash_binary()),
        "docker" => docker_binary().ok_or_else(|| "Docker Desktop is not installed or not on a standard macOS path.".to_string()),
        other => resolve_system_binary(other)
            .ok_or_else(|| format!("Unable to find the required binary: {other}")),
    }
}

fn run_lifecycle_command(app: &AppHandle, state: &LauncherState, mode: LauncherMode, start: bool) -> Result<LauncherStatus, String> {
    let runtime_root = ensure_runtime_bundle(app)?;
    let (program_name, args, working_dir) = if start {
        start_command_for(mode)
    } else {
        stop_command_for(mode)
    };
    let program = resolve_program(program_name)?;
    let cwd = if working_dir.as_os_str().is_empty() {
        runtime_root.as_path()
    } else {
        working_dir.as_path()
    };
    let result = run_command(&program, &args, cwd, &[])?;

    build_status(app, state, format_output(&result))
}

fn resolve_ui_url() -> &'static str {
    if port_is_open(80) {
        UI_URL
    } else {
        MISSION_CONTROL_FALLBACK_URL
    }
}

fn open_with_system(target: &str) -> Result<String, String> {
    let opener = resolve_system_binary("open").unwrap_or_else(|| PathBuf::from("/usr/bin/open"));
    run_command(&opener, &[target], Path::new("/"), &[]).map(|result| {
        let output = format_output(&result);

        if output.is_empty() {
            format!("Opened {target}")
        } else {
            output
        }
    })
}

fn cloudflare_bootstrap_env(runtime_root: &Path) -> Result<Vec<(&'static str, String)>, String> {
    let home = bootstrap_cloudflare_home(runtime_root);
    let config_dir = bootstrap_cloudflare_dir(runtime_root);
    reset_dir(&config_dir)?;

    Ok(vec![("HOME", home.display().to_string())])
}

fn cloudflare_origincert_path(runtime_root: &Path) -> PathBuf {
    bootstrap_cloudflare_dir(runtime_root).join("cert.pem")
}

fn cloudflare_credentials_path(runtime_root: &Path, tunnel_id: &str) -> PathBuf {
    bootstrap_cloudflare_dir(runtime_root).join(format!("{tunnel_id}.json"))
}

fn spawn_remote_access_process(
    binary: &Path,
    runtime_root: &Path,
    metadata: &RemoteAccessMetadata,
    credentials_json: &str,
) -> Result<ManagedRemoteAccess, String> {
    let materialized_dir = materialized_cloudflare_dir(runtime_root);
    reset_dir(&materialized_dir)?;

    let tunnel_id = metadata
        .tunnel_id
        .as_ref()
        .ok_or_else(|| "Remote access tunnel is not configured yet.".to_string())?;
    let hostname = metadata
        .hostname
        .as_ref()
        .ok_or_else(|| "Remote access hostname is missing.".to_string())?;

    let credentials_path = materialized_dir.join(format!("{tunnel_id}.json"));
    write_private_file(&credentials_path, credentials_json)?;

    let config_path = materialized_dir.join("config.yml");
    write_private_file(&config_path, &build_cloudflare_config(tunnel_id, hostname, &credentials_path))?;

    let log_path = remote_access_log_path(runtime_root);
    let stdout = File::create(&log_path).map_err(|error| error.to_string())?;
    let stderr = stdout.try_clone().map_err(|error| error.to_string())?;

    let child = Command::new(binary)
        .args([
            "tunnel",
            "--config",
            config_path.to_string_lossy().as_ref(),
            "--pidfile",
            remote_access_pid_path(runtime_root).to_string_lossy().as_ref(),
            "--no-autoupdate",
            "run",
            tunnel_id,
        ])
        .current_dir(runtime_root)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|error| format!("Failed to start cloudflared: {error}"))?;

    Ok(ManagedRemoteAccess {
        child,
        log_path,
        credentials_path,
        config_path,
    })
}

fn stop_remote_access_process(state: &LauncherState, runtime_root: &Path) -> Result<String, String> {
    let mut guard = state
        .remote_access
        .lock()
        .map_err(|_| "Failed to access the remote access state.".to_string())?;

    let message = if let Some(mut managed) = guard.take() {
        let _ = managed.child.kill();
        let _ = managed.child.wait();
        let _ = remove_file_if_exists(&managed.credentials_path);
        let _ = remove_file_if_exists(&managed.config_path);
        let _ = remove_file_if_exists(&remote_access_pid_path(runtime_root));
        let tail = read_log_tail(&managed.log_path);
        if tail.is_empty() {
            "Stopped Cloudflare remote access.".to_string()
        } else {
            format!("Stopped Cloudflare remote access.\n\n{tail}")
        }
    } else {
        cleanup_materialized_remote_access(runtime_root)?;
        "Remote access was not running.".to_string()
    };

    Ok(message)
}

#[tauri::command]
fn launcher_status(app: AppHandle, state: State<LauncherState>) -> Result<LauncherStatus, String> {
    build_status(
        &app,
        &state,
        "Desktop runtime prepared. Start the stack to boot local agentStack services, then configure remote access when you are ready.",
    )
}

#[tauri::command]
fn start_stack(app: AppHandle, state: State<LauncherState>) -> Result<LauncherStatus, String> {
    run_lifecycle_command(&app, &state, active_mode(), true)
}

#[tauri::command]
fn stop_stack(app: AppHandle, state: State<LauncherState>) -> Result<LauncherStatus, String> {
    run_lifecycle_command(&app, &state, active_mode(), false)
}

#[tauri::command]
fn restart_stack(app: AppHandle, state: State<LauncherState>) -> Result<LauncherStatus, String> {
    let stop_status = run_lifecycle_command(&app, &state, active_mode(), false)?;
    let start_status = run_lifecycle_command(&app, &state, active_mode(), true)?;

    build_status(
        &app,
        &state,
        format!(
            "{}\n\n{}",
            stop_status.output.trim(),
            start_status.output.trim()
        ),
    )
}

#[tauri::command]
fn open_ui(app: AppHandle, state: State<LauncherState>) -> Result<LauncherStatus, String> {
    let message = open_with_system(resolve_ui_url())?;
    build_status(&app, &state, message)
}

#[tauri::command]
fn open_runtime_dir(app: AppHandle, state: State<LauncherState>) -> Result<LauncherStatus, String> {
    let root = ensure_runtime_bundle(&app)?;
    let message = open_with_system(root.to_string_lossy().as_ref())?;
    build_status(&app, &state, message)
}

#[tauri::command]
fn open_access_guide(app: AppHandle, state: State<LauncherState>) -> Result<LauncherStatus, String> {
    let message = open_with_system(ACCESS_GUIDE_URL)?;
    build_status(&app, &state, message)
}

#[tauri::command]
fn cloudflare_login(app: AppHandle, state: State<LauncherState>) -> Result<CloudflareLoginResult, String> {
    let runtime_root = ensure_runtime_bundle(&app)?;
    let binary = require_cloudflared_binary(&app)?;
    let env_overrides = cloudflare_bootstrap_env(&runtime_root)?;
    let cert_path = cloudflare_origincert_path(&runtime_root);

    let result = run_command(&binary.path, &["tunnel", "login"], &runtime_root, &env_overrides)?;

    let cert_pem = fs::read_to_string(&cert_path)
        .map_err(|_| "Cloudflare login completed, but no cert.pem was created. Try the login again and finish the browser flow.".to_string())?;

    remove_file_if_exists(&cert_path)?;

    Ok(CloudflareLoginResult {
        status: build_status(&app, &state, format_output(&result))?,
        cert_pem,
    })
}

#[tauri::command]
fn create_remote_tunnel(
    app: AppHandle,
    state: State<LauncherState>,
    tunnel_name: String,
    hostname: String,
    access_email: Option<String>,
    cert_pem: String,
) -> Result<CloudflareTunnelResult, String> {
    validate_tunnel_name(&tunnel_name)?;
    validate_hostname(&hostname)?;
    validate_access_email(access_email.as_deref())?;

    let runtime_root = ensure_runtime_bundle(&app)?;
    let binary = require_cloudflared_binary(&app)?;
    let env_overrides = cloudflare_bootstrap_env(&runtime_root)?;
    let cert_path = cloudflare_origincert_path(&runtime_root);
    write_private_file(&cert_path, cert_pem.trim())?;

    let create_result = run_command(
        &binary.path,
        &[
            "tunnel",
            "--origincert",
            cert_path.to_string_lossy().as_ref(),
            "create",
            tunnel_name.trim(),
        ],
        &runtime_root,
        &env_overrides,
    )?;
    let combined_output = format_output(&create_result);
    let tunnel_id = extract_tunnel_uuid(&combined_output)
        .ok_or_else(|| "Cloudflare created the tunnel, but agentStack could not parse its UUID from the CLI output.".to_string())?;
    let credentials_path = cloudflare_credentials_path(&runtime_root, &tunnel_id);
    let credentials_json = fs::read_to_string(&credentials_path)
        .map_err(|_| "Cloudflare created the tunnel, but the tunnel credentials file was not found.".to_string())?;

    let route_result = run_command(
        &binary.path,
        &[
            "tunnel",
            "--origincert",
            cert_path.to_string_lossy().as_ref(),
            "route",
            "dns",
            tunnel_id.as_str(),
            hostname.trim(),
        ],
        &runtime_root,
        &env_overrides,
    )?;

    remove_file_if_exists(&cert_path)?;
    remove_file_if_exists(&credentials_path)?;

    let metadata = RemoteAccessMetadata {
        tunnel_name: Some(tunnel_name.trim().to_string()),
        tunnel_id: Some(tunnel_id.clone()),
        hostname: Some(hostname.trim().to_lowercase()),
        access_email: access_email.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()),
        access_confirmed: false,
        config_path: Some(materialized_cloudflare_dir(&runtime_root).join("config.yml").display().to_string()),
        last_started_at: None,
        last_stopped_at: None,
        last_output: Some(format!(
            "{}\n\n{}",
            combined_output,
            format_output(&route_result)
        )),
    };
    save_remote_access_metadata(&runtime_root, &metadata)?;

    Ok(CloudflareTunnelResult {
        status: build_status(
            &app,
            &state,
            format!(
                "{}\n\n{}",
                combined_output,
                format_output(&route_result)
            ),
        )?,
        credentials_json,
    })
}

#[tauri::command]
fn start_remote_access(
    app: AppHandle,
    state: State<LauncherState>,
    credentials_json: String,
) -> Result<LauncherStatus, String> {
    let runtime_root = ensure_runtime_bundle(&app)?;
    let binary = require_cloudflared_binary(&app)?;
    let mut metadata = load_remote_access_metadata(&runtime_root)?;

    if metadata.tunnel_id.is_none() || metadata.hostname.is_none() {
        return Err("Create a Cloudflare tunnel before starting remote access.".to_string());
    }

    reconcile_remote_access(&state, &runtime_root);
    {
        let guard = state
            .remote_access
            .lock()
            .map_err(|_| "Failed to access the remote access state.".to_string())?;
        if guard.is_some() {
            return build_status(&app, &state, "Remote access is already running.");
        }
    }

    let managed = spawn_remote_access_process(&binary.path, &runtime_root, &metadata, credentials_json.trim())?;
    metadata.last_started_at = Some(unix_timestamp_string());
    metadata.last_output = Some(format!(
        "Started Cloudflare remote access for {}.",
        metadata.hostname.as_deref().unwrap_or("the configured hostname")
    ));
    save_remote_access_metadata(&runtime_root, &metadata)?;

    {
        let mut guard = state
            .remote_access
            .lock()
            .map_err(|_| "Failed to access the remote access state.".to_string())?;
        *guard = Some(managed);
    }

    build_status(&app, &state, metadata.last_output.unwrap_or_default())
}

#[tauri::command]
fn stop_remote_access(app: AppHandle, state: State<LauncherState>) -> Result<LauncherStatus, String> {
    let runtime_root = ensure_runtime_bundle(&app)?;
    let message = stop_remote_access_process(&state, &runtime_root)?;
    let mut metadata = load_remote_access_metadata(&runtime_root)?;
    metadata.last_stopped_at = Some(unix_timestamp_string());
    metadata.last_output = Some(message.clone());
    save_remote_access_metadata(&runtime_root, &metadata)?;

    build_status(&app, &state, message)
}

#[tauri::command]
fn confirm_remote_access(
    app: AppHandle,
    state: State<LauncherState>,
    access_email: Option<String>,
) -> Result<LauncherStatus, String> {
    validate_access_email(access_email.as_deref())?;
    let runtime_root = ensure_runtime_bundle(&app)?;
    let mut metadata = load_remote_access_metadata(&runtime_root)?;

    if let Some(email) = access_email.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) {
        metadata.access_email = Some(email);
    }

    metadata.access_confirmed = true;
    metadata.last_output = Some(
        "Marked Cloudflare Access as configured. agentStack will keep the tunnel running locally, and the public hostname should now be gated by your Access policy."
            .to_string(),
    );
    save_remote_access_metadata(&runtime_root, &metadata)?;

    build_status(&app, &state, metadata.last_output.unwrap_or_default())
}

#[tauri::command]
fn clear_remote_access(app: AppHandle, state: State<LauncherState>) -> Result<LauncherStatus, String> {
    let runtime_root = ensure_runtime_bundle(&app)?;
    let stop_message = stop_remote_access_process(&state, &runtime_root)?;
    cleanup_materialized_remote_access(&runtime_root)?;
    clear_remote_access_metadata(&runtime_root)?;

    build_status(
        &app,
        &state,
        format!("{stop_message}\n\nCleared the local remote access metadata. Reconnect Cloudflare to create a fresh tunnel."),
    )
}

pub fn run() {
    tauri::Builder::default()
        .manage(LauncherState::default())
        .setup(|app| {
            ensure_runtime_bundle(&app.handle())?;

            let salt_path = app
                .path()
                .app_local_data_dir()
                .map_err(|error| error.to_string())?
                .join("stronghold-salt.txt");

            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())
                .map_err(|error| error.to_string())?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launcher_status,
            start_stack,
            stop_stack,
            restart_stack,
            open_ui,
            open_runtime_dir,
            open_access_guide,
            cloudflare_login,
            create_remote_tunnel,
            start_remote_access,
            stop_remote_access,
            confirm_remote_access,
            clear_remote_access
        ])
        .run(tauri::generate_context!())
        .expect("error while running agentStack desktop");
}

#[cfg(test)]
mod tests {
    use super::{build_cloudflare_config, extract_tunnel_uuid};
    use std::path::Path;

    #[test]
    fn extracts_tunnel_uuid_from_cloudflare_output() {
        let output = "Created tunnel agentstack-beta with id 12345678-90ab-cdef-1234-567890abcdef";
        assert_eq!(
            extract_tunnel_uuid(output).as_deref(),
            Some("12345678-90ab-cdef-1234-567890abcdef")
        );
    }

    #[test]
    fn builds_cloudflare_config_for_local_nginx() {
        let config = build_cloudflare_config(
            "12345678-90ab-cdef-1234-567890abcdef",
            "beta.example.com",
            Path::new("/tmp/credentials.json"),
        );

        assert!(config.contains("tunnel: 12345678-90ab-cdef-1234-567890abcdef"));
        assert!(config.contains("hostname: beta.example.com"));
        assert!(config.contains("service: http://127.0.0.1:80"));
        assert!(config.contains("credentials-file: /tmp/credentials.json"));
    }
}
