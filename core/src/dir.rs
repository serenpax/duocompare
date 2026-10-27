use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::fs as fsutil;

/// 默认跳过的目录（版本库元数据没有对比意义）。
const SKIP_DIRS: &[&str] = &[".git"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NodeStatus {
    Same,
    Modified,
    LeftOnly,
    RightOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeNode {
    pub name: String,
    pub rel_path: String,
    pub is_dir: bool,
    pub status: NodeStatus,
    pub left_path: Option<String>,
    pub right_path: Option<String>,
    pub children: Vec<TreeNode>,
}

#[derive(Default)]
struct SideScan {
    dirs: BTreeSet<String>,
    files: BTreeMap<String, PathBuf>,
}

fn scan_side(root: &Path) -> io::Result<SideScan> {
    let mut out = SideScan::default();
    scan_into(root, "", &mut out)?;
    Ok(out)
}

fn scan_into(root: &Path, rel: &str, out: &mut SideScan) -> io::Result<()> {
    let dir_path = if rel.is_empty() {
        root.to_path_buf()
    } else {
        root.join(rel)
    };
    for entry in fs::read_dir(&dir_path)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }
        let child_rel = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            out.dirs.insert(child_rel.clone());
            scan_into(root, &child_rel, out)?;
        } else if file_type.is_file() {
            out.files.insert(child_rel, entry.path());
        }
    }
    Ok(())
}

fn parent_rel(rel: &str) -> &str {
    match rel.rfind('/') {
        Some(i) => &rel[..i],
        None => "",
    }
}

fn file_name(rel: &str) -> &str {
    match rel.rfind('/') {
        Some(i) => &rel[i + 1..],
        None => rel,
    }
}

fn aggregate_dir_status(children: &[TreeNode]) -> NodeStatus {
    if children.is_empty() {
        return NodeStatus::Same;
    }
    if children.iter().all(|c| c.status == NodeStatus::Same) {
        NodeStatus::Same
    } else if children.iter().all(|c| c.status == NodeStatus::LeftOnly) {
        NodeStatus::LeftOnly
    } else if children.iter().all(|c| c.status == NodeStatus::RightOnly) {
        NodeStatus::RightOnly
    } else {
        NodeStatus::Modified
    }
}

struct PendingEntry {
    is_dir: bool,
    status: NodeStatus,
    left_path: Option<String>,
    right_path: Option<String>,
}

/// 递归对比两个目录树，返回按目录分组的节点列表（children 为直接子节点，已排序）。
pub fn compare_dirs(left: &Path, right: &Path) -> io::Result<Vec<TreeNode>> {
    let l = scan_side(left)?;
    let r = scan_side(right)?;

    let all_dirs: BTreeSet<&String> = l.dirs.iter().chain(r.dirs.iter()).collect();
    let all_files: BTreeSet<&String> = l.files.keys().chain(r.files.keys()).collect();

    let mut entries: BTreeMap<String, PendingEntry> = BTreeMap::new();

    for rel in all_dirs {
        entries.insert(
            rel.clone(),
            PendingEntry {
                is_dir: true,
                status: NodeStatus::Same,
                left_path: l.dirs.contains(rel).then(|| path_str(&left.join(rel))),
                right_path: r.dirs.contains(rel).then(|| path_str(&right.join(rel))),
            },
        );
    }

    for rel in all_files {
        let lp = l.files.get(rel);
        let rp = r.files.get(rel);
        let status = match (lp, rp) {
            (Some(a), Some(b)) => {
                if fsutil::files_equal(a, b)? {
                    NodeStatus::Same
                } else {
                    NodeStatus::Modified
                }
            }
            (Some(_), None) => NodeStatus::LeftOnly,
            (None, Some(_)) => NodeStatus::RightOnly,
            (None, None) => unreachable!(),
        };
        entries.insert(
            rel.clone(),
            PendingEntry {
                is_dir: false,
                status,
                left_path: lp.map(|p| path_str(p)),
                right_path: rp.map(|p| path_str(p)),
            },
        );
    }

    let mut by_parent: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for rel in entries.keys() {
        by_parent
            .entry(parent_rel(rel).to_string())
            .or_default()
            .push(rel.clone());
    }

    Ok(build_children("", &by_parent, &entries))
}

fn path_str(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn build_children(
    parent: &str,
    by_parent: &BTreeMap<String, Vec<String>>,
    entries: &BTreeMap<String, PendingEntry>,
) -> Vec<TreeNode> {
    let Some(child_rels) = by_parent.get(parent) else {
        return Vec::new();
    };
    child_rels
        .iter()
        .map(|rel| {
            let entry = &entries[rel];
            let children = if entry.is_dir {
                build_children(rel, by_parent, entries)
            } else {
                Vec::new()
            };
            let status = if entry.is_dir {
                aggregate_dir_status(&children)
            } else {
                entry.status
            };
            TreeNode {
                name: file_name(rel).to_string(),
                rel_path: rel.clone(),
                is_dir: entry.is_dir,
                status,
                left_path: entry.left_path.clone(),
                right_path: entry.right_path.clone(),
                children,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_pair(tag: &str) -> (PathBuf, PathBuf) {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let base = std::env::temp_dir().join(format!("duocompare-test-{tag}-{nanos}"));
        let left = base.join("left");
        let right = base.join("right");
        fs::create_dir_all(&left).unwrap();
        fs::create_dir_all(&right).unwrap();
        (left, right)
    }

    #[test]
    fn compare_reports_statuses() {
        let (left, right) = temp_pair("status");
        fs::write(left.join("same.txt"), "hello\n").unwrap();
        fs::write(right.join("same.txt"), "hello\n").unwrap();
        fs::write(left.join("changed.txt"), "v1\n").unwrap();
        fs::write(right.join("changed.txt"), "v2\n").unwrap();
        fs::create_dir_all(left.join("src")).unwrap();
        fs::create_dir_all(right.join("src")).unwrap();
        fs::write(left.join("src/only_left.rs"), "fn a() {}\n").unwrap();
        fs::write(right.join("src/only_right.rs"), "fn b() {}\n").unwrap();

        let nodes = compare_dirs(&left, &right).unwrap();

        let status_of = |rel: &str| -> NodeStatus {
            fn find<'a>(nodes: &'a [TreeNode], rel: &str) -> Option<&'a TreeNode> {
                for n in nodes {
                    if n.rel_path == rel {
                        return Some(n);
                    }
                    if let Some(f) = find(&n.children, rel) {
                        return Some(f);
                    }
                }
                None
            }
            find(&nodes, rel).unwrap().status
        };

        assert_eq!(status_of("same.txt"), NodeStatus::Same);
        assert_eq!(status_of("changed.txt"), NodeStatus::Modified);
        assert_eq!(status_of("src/only_left.rs"), NodeStatus::LeftOnly);
        assert_eq!(status_of("src/only_right.rs"), NodeStatus::RightOnly);
        assert_eq!(status_of("src"), NodeStatus::Modified);

        // .git 不应出现
        fs::create_dir_all(left.join(".git")).unwrap();
        fs::write(left.join(".git/config"), "x").unwrap();
        let nodes = compare_dirs(&left, &right).unwrap();
        assert!(!nodes.iter().any(|n| n.name == ".git"));

        fs::remove_dir_all(left.parent().unwrap()).ok();
    }

    #[test]
    fn empty_dirs_are_same() {
        let (left, right) = temp_pair("empty");
        let nodes = compare_dirs(&left, &right).unwrap();
        assert!(nodes.is_empty());
        fs::remove_dir_all(left.parent().unwrap()).ok();
    }
}
