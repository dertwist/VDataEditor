//! Optional file-type association, offered by a dialog on first launch.
//!
//! Everything here is best-effort and strictly per-user (no admin rights):
//! on Windows associations go to `HKCU\Software\Classes` via `reg.exe`, on
//! Linux a `.desktop` entry plus a custom MIME package are installed under
//! `~/.local/share`. Because the app is portable, the registered command
//! points at wherever the executable currently lives; re-running the dialog
//! (File menu) refreshes the paths after moving the binary.

/// Extensions offered for association (mirrors the old `package.json`
/// `build.fileAssociations` list).
pub const EXTENSIONS: &[&str] = &[
    "vdata", "vsmart", "vpcf", "kv3", "vsurf", "vsndstck", "vsndevts", "vpulse", "vmdl",
    "vmix", "vrman", "vmat", "vmt",
];

/// Register the associations for the current user.
pub fn associate() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| format!("cannot locate executable: {e}"))?;
    let exe = exe.to_string_lossy().into_owned();

    #[cfg(target_os = "windows")]
    return associate_windows(&exe);

    #[cfg(target_os = "linux")]
    return associate_linux(&exe);

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = exe;
        Err("File associations are not supported on this platform yet".to_owned())
    }
}

#[cfg(target_os = "windows")]
fn associate_windows(exe: &str) -> Result<String, String> {
    use std::process::Command;

    fn reg_add(key: &str, value: &str) -> Result<(), String> {
        let output = Command::new("reg")
            .args(["add", key, "/ve", "/t", "REG_SZ", "/d", value, "/f"])
            .output()
            .map_err(|e| format!("reg.exe: {e}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).into_owned())
        }
    }

    let prog_id = "VDataEditor.kv3";
    reg_add(
        &format!("HKCU\\Software\\Classes\\{prog_id}"),
        "Source 2 KV3 data",
    )?;
    reg_add(
        &format!("HKCU\\Software\\Classes\\{prog_id}\\DefaultIcon"),
        &format!("{exe},0"),
    )?;
    reg_add(
        &format!("HKCU\\Software\\Classes\\{prog_id}\\shell\\open\\command"),
        &format!("\"{exe}\" \"%1\""),
    )?;
    for ext in EXTENSIONS {
        reg_add(&format!("HKCU\\Software\\Classes\\.{ext}"), prog_id)?;
    }
    Ok(format!(
        "Associated {} file types with this executable (per-user registry)",
        EXTENSIONS.len()
    ))
}

#[cfg(target_os = "linux")]
fn associate_linux(exe: &str) -> Result<String, String> {
    use std::process::Command;

    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_owned())?;
    let share = std::path::Path::new(&home).join(".local/share");

    // Custom MIME type with globs for our extensions.
    let mime_dir = share.join("mime/packages");
    std::fs::create_dir_all(&mime_dir).map_err(|e| e.to_string())?;
    let globs: String = EXTENSIONS
        .iter()
        .map(|ext| format!("    <glob pattern=\"*.{ext}\"/>\n"))
        .collect();
    let mime_xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <mime-info xmlns=\"http://www.freedesktop.org/standards/shared-mime-info\">\n\
         \x20 <mime-type type=\"application/x-valve-kv3\">\n\
         \x20   <comment>Source 2 KV3 data</comment>\n\
         {globs}\
         \x20 </mime-type>\n\
         </mime-info>\n"
    );
    std::fs::write(mime_dir.join("vdataeditor.xml"), mime_xml).map_err(|e| e.to_string())?;

    // Desktop entry pointing at the current executable location.
    let apps = share.join("applications");
    std::fs::create_dir_all(&apps).map_err(|e| e.to_string())?;
    let desktop = format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=VDataEditor\n\
         Comment=Editor for Source 2 KV3 files\n\
         Exec=\"{exe}\" %F\n\
         Terminal=false\n\
         Categories=Development;\n\
         MimeType=application/x-valve-kv3;\n"
    );
    std::fs::write(apps.join("vdataeditor.desktop"), desktop).map_err(|e| e.to_string())?;

    // Refresh databases and set the default handler; ignore missing tools.
    let _ = Command::new("update-mime-database")
        .arg(share.join("mime"))
        .output();
    let _ = Command::new("update-desktop-database").arg(&apps).output();
    let _ = Command::new("xdg-mime")
        .args(["default", "vdataeditor.desktop", "application/x-valve-kv3"])
        .output();

    Ok(format!(
        "Installed desktop entry and MIME type for {} extensions under ~/.local/share",
        EXTENSIONS.len()
    ))
}
