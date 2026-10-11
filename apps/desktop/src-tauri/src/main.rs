mod lines;

use std::collections::VecDeque;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

const PORT: u16 = 3101;
const READY_TIMEOUT: Duration = Duration::from_secs(15);
const STOP_TIMEOUT: Duration = Duration::from_secs(5);
const LOG_TAIL: usize = 20;
// Separate from the dev data directory (spec 2026-10-11 «Decisions»).
const DATA_DIR_NAME: &str = "LifeDashboard Desktop";

enum ApiEvent {
    Ready,
    Exited,
}

#[derive(Default)]
struct Sidecar {
    child: Mutex<Option<Child>>,
    stopping: AtomicBool,
}

/// `<dataDir>/logs/api.log`, truncated per launch, plus the last lines for error dialogs.
#[derive(Clone)]
struct Log {
    file: Arc<Mutex<File>>,
    tail: Arc<Mutex<VecDeque<String>>>,
    path: PathBuf,
}

impl Log {
    fn create(path: PathBuf) -> std::io::Result<Self> {
        Ok(Self { file: Arc::new(Mutex::new(File::create(&path)?)), tail: Arc::default(), path })
    }

    fn write(&self, line: &str) {
        if let Ok(mut file) = self.file.lock() {
            let _ = writeln!(file, "{line}");
        }
        if let Ok(mut tail) = self.tail.lock() {
            if tail.len() == LOG_TAIL {
                tail.pop_front();
            }
            tail.push_back(line.to_owned());
        }
    }

    fn tail(&self) -> String {
        self.tail.lock().map(|tail| Vec::from(tail.clone()).join("\n")).unwrap_or_default()
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Sidecar::default())
        .setup(|app| {
            start(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build LifeDashboard");
    app.run(|app, event| {
        if let RunEvent::Exit = event {
            stop(app);
        }
    });
}

fn start(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app.path().data_dir()?.join(DATA_DIR_NAME);
    let logs = data_dir.join("logs");
    fs::create_dir_all(&logs)?;
    let log = Log::create(logs.join("api.log"))?;
    let resources = app.path().resource_dir()?;
    // externalBin lands next to the app executable without the target-triple suffix.
    let node = std::env::current_exe()?.parent().ok_or("no executable directory")?.join("node");
    let origin = format!("http://127.0.0.1:{PORT}");

    let mut child = Command::new(node)
        .arg(resources.join("api").join("server.mjs"))
        .env("LIFEDASHBOARD_API_PORT", PORT.to_string())
        .env("LIFEDASHBOARD_DATA_DIR", &data_dir)
        .env("LIFEDASHBOARD_UI_ORIGINS", &origin)
        .env("LIFEDASHBOARD_UI_DIR", resources.join("ui"))
        .env("LIFEDASHBOARD_RUNTIME_DIR", resources.join("api").join("runtime"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = child.stdout.take().ok_or("no API stdout")?;
    let stderr = child.stderr.take().ok_or("no API stderr")?;
    *app.state::<Sidecar>().child.lock().map_err(|_| "sidecar lock poisoned")? = Some(child);

    let (events, received) = mpsc::channel();
    let ready = events.clone();
    let dialogs = app.clone();
    pump(
        stdout,
        log.clone(),
        move |line| {
            if let Some((code, until)) = lines::pairing_code(line) {
                dialogs
                    .dialog()
                    .message(format!("Код сопряжения LifeDashboard: {code} — действует до {until}"))
                    .title("LifeDashboard")
                    .show(|_| {});
            } else if lines::is_ready(line, PORT) {
                let _ = ready.send(ApiEvent::Ready);
            }
        },
        move || {
            let _ = events.send(ApiEvent::Exited);
        },
    );
    pump(stderr, log.clone(), |_| {}, || {});
    supervise(app.clone(), received, log, origin);
    Ok(())
}

/// Writes every line of `stream` to the log and to `on_line`; `on_end` runs once at EOF.
fn pump(
    stream: impl Read + Send + 'static,
    log: Log,
    mut on_line: impl FnMut(&str) + Send + 'static,
    on_end: impl FnOnce() + Send + 'static,
) {
    thread::spawn(move || {
        for chunk in BufReader::new(stream).split(b'\n').map_while(Result::ok) {
            let line = String::from_utf8_lossy(&chunk);
            let line = line.trim_end_matches('\r');
            log.write(line);
            on_line(line);
        }
        on_end();
    });
}

/// Opens the window after the ready line from our own child; a `/health` answer could come
/// from another process that holds the port (spec 2026-10-11 «Ready line»).
fn supervise(app: AppHandle, events: Receiver<ApiEvent>, log: Log, origin: String) {
    thread::spawn(move || {
        match events.recv_timeout(READY_TIMEOUT) {
            Ok(ApiEvent::Ready) => {}
            Ok(ApiEvent::Exited) | Err(RecvTimeoutError::Disconnected) => {
                return fail(&app, "API завершился при запуске.", &log)
            }
            Err(RecvTimeoutError::Timeout) => return fail(&app, "API не запустился за 15 секунд.", &log),
        }
        if let Err(error) = open_window(&app, &origin) {
            return fail(&app, &format!("Не удалось открыть окно: {error}"), &log);
        }
        // Blocks until the API stops; a stop requested by the app is not an error.
        let _ = events.recv();
        fail(&app, "API неожиданно остановился.", &log);
    });
}

fn open_window(app: &AppHandle, origin: &str) -> Result<(), Box<dyn std::error::Error>> {
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(format!("{origin}/").parse()?))
        .title("LifeDashboard")
        .inner_size(1440.0, 900.0)
        .min_inner_size(1280.0, 720.0)
        // HTML5 folder drops must reach PackagesDialog.vue, not Tauri's file-drop handler.
        .disable_drag_drop_handler()
        .build()?;
    Ok(())
}

fn fail(app: &AppHandle, reason: &str, log: &Log) {
    if app.state::<Sidecar>().stopping.load(Ordering::SeqCst) {
        return;
    }
    app.dialog()
        .message(format!(
            "{reason}\n\nПоследние строки лога:\n{}\n\nЛог: {}",
            log.tail(),
            log.path.display()
        ))
        .title("LifeDashboard не работает")
        .kind(MessageDialogKind::Error)
        .blocking_show();
    app.exit(1);
}

/// SIGTERM lets server.ts close the database; SIGKILL after STOP_TIMEOUT.
/// `/bin/kill` avoids a libc dependency; `Child::kill` sends SIGKILL.
fn stop(app: &AppHandle) {
    let sidecar = app.state::<Sidecar>();
    sidecar.stopping.store(true, Ordering::SeqCst);
    let Some(mut child) = sidecar.child.lock().ok().and_then(|mut slot| slot.take()) else {
        return;
    };
    let _ = Command::new("/bin/kill").args(["-TERM", &child.id().to_string()]).status();
    let deadline = Instant::now() + STOP_TIMEOUT;
    while Instant::now() < deadline {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
}
