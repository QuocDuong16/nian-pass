use std::process::Command;

fn gateway() -> Command {
    Command::new(env!("CARGO_BIN_EXE_nian-pass-sync-gateway"))
}

#[test]
fn version_is_public_build_metadata() {
    let output = gateway().arg("--version").output().expect("run gateway");
    assert!(output.status.success());
    assert_eq!(
        String::from_utf8(output.stdout).expect("version stdout"),
        format!("nian-pass-sync-gateway {}\n", env!("CARGO_PKG_VERSION"))
    );
    assert!(output.stderr.is_empty());
}

#[test]
fn invalid_arguments_do_not_echo_user_controlled_values() {
    let marker = "M8_RELEASE_SECRET";
    let output = gateway()
        .args(["--unsupported-option", marker])
        .output()
        .expect("run gateway");
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    let diagnostic = String::from_utf8(output.stderr).expect("diagnostic stderr");
    assert_eq!(diagnostic, "gateway startup failed: invalid arguments\n");
    assert!(!diagnostic.contains(marker));
}
