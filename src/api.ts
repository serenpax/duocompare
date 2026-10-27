import { mockCompareDirs, mockLoadFileDiff } from "./mock";
import type { FileDiff, TreeNode } from "./types";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function compareDirs(left: string, right: string): Promise<TreeNode[]> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<TreeNode[]>("compare_dirs", { left, right });
  }
  return mockCompareDirs();
}

export async function loadFileDiff(
  left: string | null,
  right: string | null,
): Promise<FileDiff> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<FileDiff>("load_file_diff", { left, right });
  }
  return mockLoadFileDiff(left, right);
}

export async function saveFile(
  path: string,
  lines: string[],
  endsWithNewline: boolean,
): Promise<void> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_file", { path, lines, endsWithNewline });
    return;
  }
  alert(`浏览器演示模式，不执行真实写入：${path}`);
}

export async function pickFolder(): Promise<string | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    return (await open({ directory: true })) as string | null;
  }
  return window.prompt("浏览器演示模式：输入文件夹路径", "F:\\demo\\left");
}
