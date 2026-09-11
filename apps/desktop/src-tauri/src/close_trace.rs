use std::{env, fs::OpenOptions, io::Write, path::Path};

const WINDOWS_CLOSE_TRACE_ENV: &str = "NIAN_PASS_WINDOWS_CLOSE_TRACE";

pub(crate) fn trace(stage: &str) {
    let path = env::var_os(WINDOWS_CLOSE_TRACE_ENV);
    append_stage(path.as_deref().map(Path::new), stage);
}

fn append_stage(path: Option<&Path>, stage: &str) {
    let Some(path) = path else {
        return;
    };
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    let _ = writeln!(file, "{stage}");
    let _ = file.flush();
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::Path,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::append_stage;

    fn trace_path(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("nian-pass-{name}-{nonce}.log"))
    }

    #[test]
    fn absent_path_does_not_write() {
        append_stage(None, "RUST_APP_RUNNING");
    }

    #[test]
    fn enabled_trace_appends_stages_in_order() {
        let path = trace_path("close-trace");
        append_stage(Some(&path), "RUST_APP_RUNNING");
        append_stage(Some(&path), "RUST_WINDOW_CLOSE_REQUESTED");
        assert_eq!(
            fs::read_to_string(&path).expect("trace contents"),
            "RUST_APP_RUNNING\nRUST_WINDOW_CLOSE_REQUESTED\n"
        );
        fs::remove_file(path).expect("remove trace");
    }

    #[test]
    fn file_write_failure_does_not_panic() {
        append_stage(
            Some(Path::new("/definitely-missing/nian-pass-close-trace.log")),
            "RUST_APP_RUNNING",
        );
    }
}
