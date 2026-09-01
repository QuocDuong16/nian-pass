use std::{
    env,
    ffi::OsString,
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

use browser_native_protocol::{
    CHROMIUM_DEVELOPMENT_EXTENSION_ID, FIREFOX_DEVELOPMENT_EXTENSION_ID, HOST_NAME,
    desktop_endpoint_description,
};
use serde::Serialize;

#[derive(Clone, Copy)]
pub enum Command {
    Install,
    Uninstall,
    Doctor,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Browser {
    Chrome,
    Chromium,
    Edge,
    Firefox,
}

impl Browser {
    const ALL: [Self; 4] = [Self::Chrome, Self::Chromium, Self::Edge, Self::Firefox];

    fn parse(value: &str) -> Option<Self> {
        match value {
            "chrome" => Some(Self::Chrome),
            "chromium" => Some(Self::Chromium),
            "edge" => Some(Self::Edge),
            "firefox" => Some(Self::Firefox),
            _ => None,
        }
    }

    const fn label(self) -> &'static str {
        match self {
            Self::Chrome => "Chrome",
            Self::Chromium => "Chromium",
            Self::Edge => "Edge",
            Self::Firefox => "Firefox",
        }
    }

    const fn is_firefox(self) -> bool {
        matches!(self, Self::Firefox)
    }
}

#[derive(Serialize)]
struct ChromiumManifest<'a> {
    name: &'a str,
    description: &'a str,
    path: &'a str,
    #[serde(rename = "type")]
    kind: &'a str,
    allowed_origins: [&'a str; 1],
}

#[derive(Serialize)]
struct FirefoxManifest<'a> {
    name: &'a str,
    description: &'a str,
    path: &'a str,
    #[serde(rename = "type")]
    kind: &'a str,
    allowed_extensions: [&'a str; 1],
}

pub fn run(command: Command, arguments: impl Iterator<Item = OsString>) -> Result<(), String> {
    let browsers = parse_browsers(arguments)?;
    let executable = env::current_exe().map_err(|_| "cannot resolve executable path")?;
    validate_executable(&executable)?;
    let mut output = io::stdout().lock();
    for browser in browsers {
        match command {
            Command::Install => install(browser, &executable)?,
            Command::Uninstall => uninstall(browser)?,
            Command::Doctor => doctor(browser, &executable, &mut output)?,
        }
    }
    if matches!(command, Command::Doctor) {
        let endpoint = desktop_endpoint_description().unwrap_or_else(|_| "unavailable".to_owned());
        writeln!(output, "desktop endpoint: {endpoint}").map_err(|_| "doctor output failed")?;
    }
    Ok(())
}

fn parse_browsers(mut arguments: impl Iterator<Item = OsString>) -> Result<Vec<Browser>, String> {
    let Some(argument) = arguments.next() else {
        return Ok(Browser::ALL.to_vec());
    };
    if arguments.next().is_some() {
        return Err("expected at most one browser identifier".to_owned());
    }
    let value = argument
        .to_str()
        .ok_or_else(|| "invalid browser identifier".to_owned())?;
    if value == "all" {
        return Ok(Browser::ALL.to_vec());
    }
    Browser::parse(value)
        .map(|browser| vec![browser])
        .ok_or_else(|| "unknown browser identifier".to_owned())
}

fn validate_executable(path: &Path) -> Result<(), String> {
    if !path.is_absolute() || path.as_os_str().to_string_lossy().contains('\0') {
        return Err("native host executable path must be absolute".to_owned());
    }
    Ok(())
}

fn manifest_json(browser: Browser, executable: &Path) -> Result<Vec<u8>, String> {
    let path = executable
        .to_str()
        .ok_or_else(|| "executable path is not UTF-8".to_owned())?;
    let description = "Nian Pass browser integration transport";
    let bytes = if browser.is_firefox() {
        serde_json::to_vec_pretty(&FirefoxManifest {
            name: HOST_NAME,
            description,
            path,
            kind: "stdio",
            allowed_extensions: [FIREFOX_DEVELOPMENT_EXTENSION_ID],
        })
    } else {
        let allowed = format!("chrome-extension://{CHROMIUM_DEVELOPMENT_EXTENSION_ID}/");
        serde_json::to_vec_pretty(&ChromiumManifest {
            name: HOST_NAME,
            description,
            path,
            kind: "stdio",
            allowed_origins: [allowed.as_str()],
        })
    };
    bytes.map_err(|_| "manifest serialization failed".to_owned())
}

#[cfg(unix)]
fn manifest_path(browser: Browser) -> Result<PathBuf, String> {
    let home = env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "home directory is unavailable".to_owned())?;
    if !home.is_absolute() {
        return Err("home directory must be absolute".to_owned());
    }
    let config = env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config"));
    if !config.is_absolute() {
        return Err("config directory must be absolute".to_owned());
    }
    let directory = match browser {
        Browser::Chrome => config.join("google-chrome/NativeMessagingHosts"),
        Browser::Chromium => config.join("chromium/NativeMessagingHosts"),
        Browser::Edge => config.join("microsoft-edge/NativeMessagingHosts"),
        Browser::Firefox => home.join(".mozilla/native-messaging-hosts"),
    };
    Ok(directory.join(format!("{HOST_NAME}.json")))
}

#[cfg(windows)]
fn manifest_path(browser: Browser) -> Result<PathBuf, String> {
    let root = env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "LOCALAPPDATA is unavailable".to_owned())?;
    if !root.is_absolute() {
        return Err("LOCALAPPDATA must be absolute".to_owned());
    }
    Ok(windows_manifest_path(&root, browser))
}

#[cfg(any(windows, test))]
fn windows_manifest_path(root: &Path, browser: Browser) -> PathBuf {
    root.join("Nian Pass/Browser Native Messaging")
        .join(format!(
            "{}-{HOST_NAME}.json",
            browser.label().to_ascii_lowercase()
        ))
}

fn install(browser: Browser, executable: &Path) -> Result<(), String> {
    let path = manifest_path(browser)?;
    let bytes = manifest_json(browser, executable)?;
    write_manifest_transactionally(&path, &bytes)?;
    #[cfg(windows)]
    register_windows(browser, &path)?;
    Ok(())
}

fn uninstall(browser: Browser) -> Result<(), String> {
    let path = manifest_path(browser)?;
    match fs::remove_file(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(_) => return Err("could not remove native host manifest".to_owned()),
    }
    #[cfg(windows)]
    unregister_windows(browser)?;
    Ok(())
}

fn doctor(browser: Browser, executable: &Path, output: &mut impl Write) -> Result<(), String> {
    let path = manifest_path(browser)?;
    let mut expected = manifest_json(browser, executable)?;
    expected.push(b'\n');
    let installed = fs::read(&path).is_ok_and(|bytes| bytes == expected);
    writeln!(
        output,
        "{} manifest installed: {installed}",
        browser.label()
    )
    .map_err(|_| "doctor output failed")?;
    writeln!(output, "host executable: {}", executable.display())
        .map_err(|_| "doctor output failed".to_owned())
}

fn write_manifest_transactionally(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "manifest path has no parent".to_owned())?;
    fs::create_dir_all(parent).map_err(|_| "could not create native host directory")?;
    let temporary = path.with_extension(format!("json.{}.tmp", std::process::id()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|_| "could not create candidate manifest")?;
    file.write_all(bytes)
        .map_err(|_| "could not write candidate manifest")?;
    file.write_all(b"\n")
        .map_err(|_| "could not finish candidate manifest")?;
    file.sync_all()
        .map_err(|_| "could not sync candidate manifest")?;
    serde_json::from_slice::<serde_json::Value>(bytes)
        .map_err(|_| "candidate manifest is invalid")?;
    place_manifest(&temporary, path)
}

#[cfg(unix)]
fn place_manifest(temporary: &Path, path: &Path) -> Result<(), String> {
    fs::rename(temporary, path).map_err(|_| "could not place native host manifest".to_owned())
}

#[cfg(windows)]
fn place_manifest(temporary: &Path, path: &Path) -> Result<(), String> {
    if !path.exists() {
        return fs::rename(temporary, path)
            .map_err(|_| "could not place native host manifest".to_owned());
    }
    let backup = path.with_extension(format!("json.{}.backup", std::process::id()));
    fs::rename(path, &backup).map_err(|_| "could not stage existing native host manifest")?;
    if fs::rename(temporary, path).is_err() {
        let _restored = fs::rename(&backup, path);
        let _removed = fs::remove_file(temporary);
        return Err("could not place native host manifest".to_owned());
    }
    fs::remove_file(backup)
        .map_err(|_| "could not finish native host manifest replacement".to_owned())
}

#[cfg(any(windows, test))]
fn registry_path(browser: Browser) -> String {
    let vendor = match browser {
        Browser::Chrome => "Google\\Chrome",
        Browser::Chromium => "Chromium",
        Browser::Edge => "Microsoft\\Edge",
        Browser::Firefox => "Mozilla",
    };
    format!(r"Software\{vendor}\NativeMessagingHosts\{HOST_NAME}")
}

#[cfg(windows)]
fn register_windows(browser: Browser, manifest: &Path) -> Result<(), String> {
    use winreg::{RegKey, enums::HKEY_CURRENT_USER};

    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = current_user
        .create_subkey(registry_path(browser))
        .map_err(|_| "could not create HKCU registration")?;
    key.set_value("", &manifest.to_string_lossy().as_ref())
        .map_err(|_| "could not write HKCU registration".to_owned())
}

#[cfg(windows)]
fn unregister_windows(browser: Browser) -> Result<(), String> {
    use winreg::{RegKey, enums::HKEY_CURRENT_USER};

    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    match current_user.delete_subkey(registry_path(browser)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("could not remove HKCU registration".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use serde_json::Value;

    use super::{Browser, manifest_json, parse_browsers, registry_path, windows_manifest_path};

    #[test]
    fn browser_identifier_is_exact_and_bounded() {
        assert_eq!(
            parse_browsers(["firefox".into()].into_iter()),
            Ok(vec![Browser::Firefox])
        );
        assert!(parse_browsers(["brave".into()].into_iter()).is_err());
        assert!(parse_browsers(["chrome".into(), "extra".into()].into_iter()).is_err());
    }

    #[test]
    fn chromium_and_firefox_manifests_use_distinct_allow_keys() {
        let executable = Path::new("/opt/nian-pass/nian-pass-browser-host");
        let chromium: Value = serde_json::from_slice(
            &manifest_json(Browser::Chromium, executable).unwrap_or_default(),
        )
        .unwrap_or(Value::Null);
        let firefox: Value = serde_json::from_slice(
            &manifest_json(Browser::Firefox, executable).unwrap_or_default(),
        )
        .unwrap_or(Value::Null);
        assert!(chromium.get("allowed_origins").is_some());
        assert!(chromium.get("allowed_extensions").is_none());
        assert!(firefox.get("allowed_extensions").is_some());
        assert!(firefox.get("allowed_origins").is_none());
    }

    #[test]
    fn windows_registration_plan_is_per_user_and_browser_specific() {
        let root = Path::new("/synthetic/localappdata");
        for (browser, vendor) in [
            (Browser::Chrome, r"Google\Chrome"),
            (Browser::Chromium, "Chromium"),
            (Browser::Edge, r"Microsoft\Edge"),
            (Browser::Firefox, "Mozilla"),
        ] {
            assert_eq!(
                registry_path(browser),
                format!(r"Software\{vendor}\NativeMessagingHosts\io.nianpass.browser")
            );
            let path = windows_manifest_path(root, browser);
            assert!(path.is_absolute());
            assert!(path.to_string_lossy().contains("Nian Pass"));
        }
    }
}
