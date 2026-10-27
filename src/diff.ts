import { diffLines } from "diff";
import type { DiffOp } from "./types";

function countLines(value: string): number {
  if (value === "") return 0;
  const parts = value.split("\n").length;
  return value.endsWith("\n") ? parts - 1 : parts;
}

/**
 * 前端行级 diff：用于合并操作后的即时重排，以及浏览器演示模式。
 * 与 Rust 核心的规则保持一致（相邻删除+插入合并为 replace）。
 */
export function lineDiff(left: string[], right: string[]): DiffOp[] {
  const a = left.join("\n");
  const b = right.join("\n");

  // join 后 "" 与 [""] 无法区分，单独处理空白行极端情况
  if (a === "" && b === "") {
    if (left.length === right.length) {
      return left.length === 0
        ? []
        : [
            {
              kind: "equal",
              old_start: 0,
              old_len: left.length,
              new_start: 0,
              new_len: right.length,
            },
          ];
    }
    const ops: DiffOp[] = [];
    if (left.length > 0) {
      ops.push({ kind: "delete", old_start: 0, old_len: left.length, new_start: 0, new_len: 0 });
    }
    if (right.length > 0) {
      ops.push({ kind: "insert", old_start: 0, old_len: 0, new_start: 0, new_len: right.length });
    }
    return ops;
  }

  const ops: DiffOp[] = [];
  let li = 0;
  let ri = 0;
  let pendingDelete: DiffOp | null = null;

  const flush = () => {
    if (pendingDelete) {
      ops.push(pendingDelete);
      pendingDelete = null;
    }
  };

  for (const part of diffLines(a, b)) {
    const count = part.count ?? countLines(part.value);
    if (!part.added && !part.removed) {
      flush();
      if (count > 0) {
        ops.push({
          kind: "equal",
          old_start: li,
          old_len: count,
          new_start: ri,
          new_len: count,
        });
        li += count;
        ri += count;
      }
    } else if (part.removed) {
      if (pendingDelete) {
        pendingDelete.old_len += count;
      } else {
        pendingDelete = {
          kind: "delete",
          old_start: li,
          old_len: count,
          new_start: ri,
          new_len: 0,
        };
      }
      li += count;
    } else {
      if (pendingDelete) {
        ops.push({
          kind: "replace",
          old_start: pendingDelete.old_start,
          old_len: pendingDelete.old_len,
          new_start: ri,
          new_len: count,
        });
        pendingDelete = null;
      } else {
        ops.push({ kind: "insert", old_start: li, old_len: 0, new_start: ri, new_len: count });
      }
      ri += count;
    }
  }
  flush();
  return ops;
}
