use std::fs;
use std::io::{self, Read};
use std::path::Path;

use crate::diff::{join_lines, split_lines};

const CHUNK: usize = 64 * 1024;

/// 逐块字节比较，长度不同直接判定不等。
pub fn files_equal(a: &Path, b: &Path) -> io::Result<bool> {
    if fs::metadata(a)?.len() != fs::metadata(b)?.len() {
        return Ok(false);
    }
    let mut fa = fs::File::open(a)?;
    let mut fb = fs::File::open(b)?;
    let mut ba = vec![0u8; CHUNK];
    let mut bb = vec![0u8; CHUNK];
    loop {
        let na = read_up_to(&mut fa, &mut ba)?;
        let nb = read_up_to(&mut fb, &mut bb)?;
        if na != nb {
            return Ok(false);
        }
        if na == 0 {
            return Ok(true);
        }
        if ba[..na] != bb[..nb] {
            return Ok(false);
        }
    }
}

fn read_up_to(f: &mut fs::File, buf: &mut [u8]) -> io::Result<usize> {
    let mut total = 0;
    while total < buf.len() {
        let n = f.read(&mut buf[total..])?;
        if n == 0 {
            break;
        }
        total += n;
    }
    Ok(total)
}

/// 读取文本文件并按统一规则切行。二进制/非 UTF-8 文件返回 Err。
pub fn read_text_lines(path: &Path) -> Result<(Vec<String>, bool), String> {
    let bytes = fs::read(path).map_err(|e| format!("读取失败 {}: {e}", path.display()))?;
    if is_binary(&bytes) {
        return Err("binary".into());
    }
    let text = String::from_utf8(bytes).map_err(|_| "non-utf8".to_string())?;
    Ok(split_lines(&text))
}

pub fn write_text_file(path: &Path, lines: &[String], ends_with_newline: bool) -> Result<(), String> {
    let content = join_lines(lines, ends_with_newline);
    fs::write(path, content).map_err(|e| format!("写入失败 {}: {e}", path.display()))
}

pub fn is_binary(sample: &[u8]) -> bool {
    sample.contains(&0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_binary_by_nul_byte() {
        assert!(is_binary(&[0x41, 0x00, 0x42]));
        assert!(!is_binary(b"plain text\n"));
    }

    #[test]
    fn file_equal_round_trip() {
        let dir = std::env::temp_dir().join(format!(
            "duocompare-fs-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.txt");
        let b = dir.join("b.txt");
        fs::write(&a, "x\ny\n").unwrap();
        fs::write(&b, "x\ny\n").unwrap();
        assert!(files_equal(&a, &b).unwrap());
        fs::write(&b, "x\nz\n").unwrap();
        assert!(!files_equal(&a, &b).unwrap());

        let (lines, ends) = read_text_lines(&a).unwrap();
        assert_eq!(lines, vec!["x".to_string(), "y".to_string()]);
        assert!(ends);
        fs::remove_dir_all(&dir).ok();
    }
}
