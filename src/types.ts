export type NodeStatus = "same" | "modified" | "left-only" | "right-only";

export interface TreeNode {
  name: string;
  rel_path: string;
  is_dir: boolean;
  status: NodeStatus;
  left_path: string | null;
  right_path: string | null;
  children: TreeNode[];
}

export type ChangeKind = "equal" | "delete" | "insert" | "replace";

export interface DiffOp {
  kind: ChangeKind;
  old_start: number;
  old_len: number;
  new_start: number;
  new_len: number;
}

export interface FileDiff {
  left_lines: string[];
  right_lines: string[];
  left_ends_nl: boolean;
  right_ends_nl: boolean;
  ops: DiffOp[];
  left_missing: boolean;
  right_missing: boolean;
  left_binary: boolean;
  right_binary: boolean;
}

export interface SelectedFile {
  name: string;
  relPath: string;
  status: NodeStatus;
  left: string | null;
  right: string | null;
}

export const STATUS_LABEL: Record<NodeStatus, string> = {
  same: "相同",
  modified: "差异",
  "left-only": "仅左侧",
  "right-only": "仅右侧",
};
