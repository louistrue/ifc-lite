// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Native file dialog commands
//!
//! Provides native file picker dialogs for opening IFC files.

use super::types::FileInfo;
use tauri_plugin_dialog::DialogExt;

/// Open a native file dialog to select an IFC file
/// Returns file info including path, name, and size (not contents)
#[tauri::command]
pub async fn open_ifc_file(app: tauri::AppHandle) -> Result<Option<FileInfo>, String> {
    let file_path = app
        .dialog()
        .file()
        .add_filter("IFC Files", &["ifc", "ifczip", "ifcxml"])
        .add_filter("All Files", &["*"])
        .set_title("Open IFC File")
        .blocking_pick_file();

    match file_path {
        Some(path) => {
            let path_str = path.to_string();

            // Get file metadata
            let metadata = tokio::fs::metadata(&path_str)
                .await
                .map_err(|e| format!("Failed to read file metadata: {}", e))?;

            let name = std::path::Path::new(&path_str)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown.ifc")
                .to_string();

            Ok(Some(FileInfo {
                path: path_str,
                name,
                size: metadata.len(),
            }))
        }
        None => Ok(None),
    }
}
