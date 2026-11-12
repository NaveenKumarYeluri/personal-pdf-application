use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::path::PathBuf;
use tauri_plugin_dialog::DialogExt;

/// Convert a dialog result into a plain filesystem path string.
fn file_path_string(path: tauri_plugin_dialog::FilePath) -> Option<String> {
    path.into_path()
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

/// Show the native Open dialog and return the chosen PDF path.
#[tauri::command]
async fn pick_pdf_to_open(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .set_title("Open PDF")
        .add_filter("PDF Documents", &["pdf"])
        .blocking_pick_file()
        .and_then(file_path_string)
}

/// Show the native Save dialog and return the chosen destination path.
#[tauri::command]
async fn pick_pdf_save_path(app: tauri::AppHandle, name: String) -> Option<String> {
    app.dialog()
        .file()
        .set_title("Save PDF")
        .set_file_name(name)
        .add_filter("PDF Documents", &["pdf"])
        .blocking_save_file()
        .and_then(file_path_string)
        .map(ensure_pdf_extension)
}

/// Desktop save dialogs do not always append the filter extension (GTK), so
/// make sure the file we are about to write is a `.pdf`.
fn ensure_pdf_extension(path: String) -> String {
    if path.to_lowercase().ends_with(".pdf") {
        path
    } else {
        format!("{path}.pdf")
    }
}

/// Read a PDF from disk and return it base64 encoded (compact over IPC).
#[tauri::command]
async fn read_pdf_file(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !path.to_lowercase().ends_with(".pdf") {
        return Err("Access denied: only .pdf files may be read".to_string());
    }
    let bytes = std::fs::read(&p).map_err(|e| format!("Could not read {path}: {e}"))?;
    // Verify basic PDF magic bytes (%PDF-)
    if bytes.len() >= 4 && !bytes.starts_with(b"%PDF") {
        return Err("File is not a valid PDF document (missing %PDF header)".to_string());
    }
    Ok(STANDARD.encode(bytes))
}

/// Replace a PDF on disk with the supplied bytes.
#[tauri::command]
async fn write_pdf_file(path: String, data: String) -> Result<(), String> {
    if !path.to_lowercase().ends_with(".pdf") {
        return Err("Access denied: destination file must have a .pdf extension".to_string());
    }
    let bytes = STANDARD
        .decode(data)
        .map_err(|e| format!("Invalid PDF data: {e}"))?;
    if bytes.len() >= 4 && !bytes.starts_with(b"%PDF") {
        return Err("Payload is not a valid PDF document (missing %PDF header)".to_string());
    }
    write_atomic(PathBuf::from(path), &bytes)
}

/// Write through a sibling temporary file so a failed write never truncates the
/// user's original document.
fn write_atomic(path: PathBuf, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid destination path".to_string())?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("document.pdf");
    let temp = parent.join(format!(".{}.{}.tmp", file_name, std::process::id()));

    std::fs::write(&temp, bytes).map_err(|e| format!("Could not write file: {e}"))?;

    // Antivirus/cloud-sync tools can briefly hold the freshly written file, so
    // retry the atomic swap a couple of times before giving up.
    let mut last_error = None;
    for attempt in 0..3 {
        match std::fs::rename(&temp, &path) {
            Ok(()) => return Ok(()),
            Err(err) => {
                last_error = Some(err);
                if attempt < 2 {
                    std::thread::sleep(std::time::Duration::from_millis(60));
                }
            }
        }
    }

    let _ = std::fs::remove_file(&temp);
    Err(format!(
        "Could not replace the original file: {}",
        last_error.map(|e| e.to_string()).unwrap_or_default()
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            pick_pdf_to_open,
            pick_pdf_save_path,
            read_pdf_file,
            write_pdf_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
