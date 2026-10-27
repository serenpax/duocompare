use serde::{Deserialize, Serialize};
use similar::{capture_diff_slices, Algorithm, DiffTag};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Equal,
    Delete,
    Insert,
    Replace,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffOp {
    pub kind: ChangeKind,
    pub old_start: usize,
    pub old_len: usize,
    pub new_start: usize,
    pub new_len: usize,
}

/// 按 '\n' 切分为行（保留行内 '\r'），若文本以换行结尾则丢弃末尾空串并记录标记。
/// 前后端切分逻辑保持一致，保证行号对齐。
pub fn split_lines(text: &str) -> (Vec<String>, bool) {
    let ends_with_newline = text.ends_with('\n');
    let body = if ends_with_newline && !text.is_empty() {
        &text[..text.len() - 1]
    } else {
        text
    };
    let lines = body.split('\n').map(|s| s.to_string()).collect();
    (lines, ends_with_newline)
}

pub fn join_lines(lines: &[String], ends_with_newline: bool) -> String {
    let mut out = lines.join("\n");
    if ends_with_newline {
        out.push('\n');
    }
    out
}

/// 行级差异。相邻的 Delete + Insert 合并为 Replace，方便前端按块渲染。
pub fn line_diff(left: &[String], right: &[String]) -> Vec<DiffOp> {
    let raw = capture_diff_slices(Algorithm::Myers, left, right);
    let mut ops: Vec<DiffOp> = Vec::with_capacity(raw.len());
    for op in raw {
        let old_range = op.old_range();
        let new_range = op.new_range();
        let kind = match op.tag() {
            DiffTag::Equal => ChangeKind::Equal,
            DiffTag::Delete => ChangeKind::Delete,
            DiffTag::Insert => ChangeKind::Insert,
            DiffTag::Replace => ChangeKind::Replace,
        };
        let next = DiffOp {
            kind,
            old_start: old_range.start,
            old_len: old_range.len(),
            new_start: new_range.start,
            new_len: new_range.len(),
        };
        // 把“先删后插且起点相同”合并成 Replace
        if next.kind == ChangeKind::Insert {
            if let Some(prev) = ops.last_mut() {
                if prev.kind == ChangeKind::Delete
                    && prev.old_start == next.old_start
                    && prev.new_start == next.new_start
                {
                    prev.kind = ChangeKind::Replace;
                    prev.new_len = next.new_len;
                    continue;
                }
            }
        }
        ops.push(next);
    }
    ops.into_iter().filter(|op| {
        op.kind != ChangeKind::Equal || op.old_len > 0
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(lines: &[&str]) -> Vec<String> {
        lines.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn split_and_join_round_trip() {
        let (lines, ends) = split_lines("a\nb\n");
        assert_eq!(lines, v(&["a", "b"]));
        assert!(ends);
        assert_eq!(join_lines(&lines, ends), "a\nb\n");

        let (lines, ends) = split_lines("a\nb");
        assert_eq!(lines, v(&["a", "b"]));
        assert!(!ends);
        assert_eq!(join_lines(&lines, ends), "a\nb");

        let (lines, ends) = split_lines("");
        assert_eq!(lines, v(&[""]));
        assert!(!ends);

        let (lines, ends) = split_lines("a\n\n");
        assert_eq!(lines, v(&["a", ""]));
        assert!(ends);
    }

    #[test]
    fn diff_equal() {
        let ops = line_diff(&v(&["a", "b"]), &v(&["a", "b"]));
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].kind, ChangeKind::Equal);
        assert_eq!(ops[0].old_len, 2);
    }

    #[test]
    fn diff_insert() {
        let ops = line_diff(&v(&["a", "c"]), &v(&["a", "b", "c"]));
        assert!(ops.iter().any(|op| {
            op.kind == ChangeKind::Insert && op.new_start == 1 && op.new_len == 1
        }));
    }

    #[test]
    fn diff_delete() {
        let ops = line_diff(&v(&["a", "b", "c"]), &v(&["a", "c"]));
        assert!(ops.iter().any(|op| {
            op.kind == ChangeKind::Delete && op.old_start == 1 && op.old_len == 1
        }));
    }

    #[test]
    fn diff_replace_merged() {
        let ops = line_diff(&v(&["a", "x", "c"]), &v(&["a", "y", "c"]));
        let replace = ops
            .iter()
            .find(|op| op.kind == ChangeKind::Replace)
            .expect("应产生 Replace 操作");
        assert_eq!(replace.old_start, 1);
        assert_eq!(replace.old_len, 1);
        assert_eq!(replace.new_start, 1);
        assert_eq!(replace.new_len, 1);
    }

    #[test]
    fn diff_from_empty() {
        let ops = line_diff(&[], &v(&["a"]));
        assert!(ops.iter().any(|op| op.kind == ChangeKind::Insert));
        let ops = line_diff(&v(&["a"]), &[]);
        assert!(ops.iter().any(|op| op.kind == ChangeKind::Delete));
    }
}
