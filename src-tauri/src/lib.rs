use std::path::Path;

use duocompare_core::diff::{line_diff, DiffOp};
use duocompare_core::dir::{compare_dirs as core_compare_dirs, TreeNode};
use duocompare_core::fs as core_fs;
use serde::Serialize;

#[derive(Serialize)]
pub struct FileDiffPayload {
    pub left_lines: Vec<String>,
    pub right_lines: Vec<String>,
    pub left_ends_nl: bool,
    pub right_ends_nl: bool,
    pub ops: Vec<DiffOp>,
    pub left_missing: bool,
    pub right_missing: bool,
    pub left_binary: bool,
    pub right_binary: bool,
}

type SideLoaded = (Vec<String>, bool, bool, bool); // (lines, ends_nl, missing, binary)

fn load_side(path: Option<String>) -> Result<SideLoaded, String> {
    match path {
        None => Ok((Vec::new(), false, true, false)),
        Some(p) => {
            if !Path::new(&p).exists() {
                return Ok((Vec::new(), false, true, false));
            }
            match core_fs::read_text_lines(Path::new(&p)) {
                Ok((lines, ends)) => Ok((lines, ends, false, false)),
                Err(_) => Ok((Vec::new(), false, false, true)),
            }
        }
    }
}

#[tauri::command]
fn compare_dirs(left: String, right: String) -> Result<Vec<TreeNode>, String> {
    let left = Path::new(&left);
    let right = Path::new(&right);
    if !left.is_dir() {
        return Err(format!("左侧路径不存在或不是文件夹: {}", left.display()));
    }
    if !right.is_dir() {
        return Err(format!("右侧路径不存在或不是文件夹: {}", right.display()));
    }
    core_compare_dirs(left, right).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_file_diff(left: Option<String>, right: Option<String>) -> Result<FileDiffPayload, String> {
    let (left_lines, left_ends_nl, left_missing, left_binary) = load_side(left)?;
    let (right_lines, right_ends_nl, right_missing, right_binary) = load_side(right)?;
    let ops = if left_binary || right_binary {
        Vec::new()
    } else {
        line_diff(&left_lines, &right_lines)
    };
    Ok(FileDiffPayload {
        left_lines,
        right_lines,
        left_ends_nl,
        right_ends_nl,
        ops,
        left_missing,
        right_missing,
        left_binary,
        right_binary,
    })
}

#[tauri::command]
fn save_file(path: String, lines: Vec<String>, ends_with_newline: bool) -> Result<(), String> {
    core_fs::write_text_file(Path::new(&path), &lines, ends_with_newline)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            compare_dirs,
            load_file_diff,
            save_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
