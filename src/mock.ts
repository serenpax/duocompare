import { lineDiff } from "./diff";
import type { FileDiff, TreeNode } from "./types";

/**
 * 浏览器演示模式的示例数据：让 UI 可以脱离 Tauri 在 vite dev / 截图验证中运行。
 */

interface Fixture {
  lines: string[];
  ends: boolean;
}

const f = (...lines: string[]): Fixture => ({ lines, ends: true });

const FIXTURES: Record<string, Fixture> = {
  "mock://left/src/app.ts": f(
    'import { trim } from "./utils";',
    "",
    "export interface User {",
    "  id: number;",
    "  name: string;",
    "}",
    "",
    "export function greet(user: User): string {",
    '  return `Hello, ${trim(user.name)}`;',
    "}",
    "",
    "export function main() {",
    '  console.log(greet({ id: 1, name: "world" }));',
    "}",
  ),
  "mock://right/src/app.ts": f(
    'import { trim } from "./utils";',
    "",
    "export interface User {",
    "  id: number;",
    "  name: string;",
    "  email?: string;",
    "}",
    "",
    "export function greet(user: User): string {",
    '  return `Hi, ${trim(user.name)}!`;',
    "}",
    "",
    "export function main() {",
    '  console.log(greet({ id: 1, name: "world", email: "w@example.com" }));',
    "}",
  ),
  "mock://left/src/utils.ts": f(
    "export function trim(s: string): string {",
    "  return s.trim();",
    "}",
  ),
  "mock://right/src/utils.ts": f(
    "export function trim(s: string): string {",
    "  return s.trim();",
    "}",
  ),
  "mock://left/src/legacy.ts": f(
    "// 旧版本遗留代码，仅存在于左侧",
    "export function legacyParse(input: string): number {",
    "  return parseInt(input, 10);",
    "}",
  ),
  "mock://right/src/new-feature.ts": f(
    "// 新功能，仅存在于右侧",
    "export function formatSize(bytes: number): string {",
    '  return `${(bytes / 1024).toFixed(1)} KB`;',
    "}",
  ),
  "mock://left/README.md": f(
    "# Demo 项目",
    "",
    "这是一个用于演示的示例项目。",
    "安装方式：npm install",
  ),
  "mock://right/README.md": f(
    "# Demo 项目",
    "",
    "这是一个用于演示的示例项目。",
    "安装方式：npm install",
    "",
    "## 更新日志",
    "- 新增 formatSize 工具函数",
  ),
  "mock://left/package.json": f("{", '  "name": "demo",', '  "version": "1.0.0"', "}"),
  "mock://right/package.json": f("{", '  "name": "demo",', '  "version": "1.0.0"', "}"),
};

const fileNode = (
  rel: string,
  status: TreeNode["status"],
  leftKey: string | null,
  rightKey: string | null,
): TreeNode => ({
  name: rel.split("/").pop()!,
  rel_path: rel,
  is_dir: false,
  status,
  left_path: leftKey,
  right_path: rightKey,
  children: [],
});

export const SAMPLE_TREE: TreeNode[] = [
  {
    name: "src",
    rel_path: "src",
    is_dir: true,
    status: "modified",
    left_path: "mock://left/src",
    right_path: "mock://right/src",
    children: [
      fileNode("src/app.ts", "modified", "mock://left/src/app.ts", "mock://right/src/app.ts"),
      fileNode("src/legacy.ts", "left-only", "mock://left/src/legacy.ts", null),
      fileNode("src/new-feature.ts", "right-only", null, "mock://right/src/new-feature.ts"),
      fileNode("src/utils.ts", "same", "mock://left/src/utils.ts", "mock://right/src/utils.ts"),
    ],
  },
  fileNode("README.md", "modified", "mock://left/README.md", "mock://right/README.md"),
  fileNode("package.json", "same", "mock://left/package.json", "mock://right/package.json"),
];

export function mockCompareDirs(): TreeNode[] {
  return SAMPLE_TREE;
}

export function mockLoadFileDiff(left: string | null, right: string | null): FileDiff {
  const lf = left ? FIXTURES[left] : undefined;
  const rf = right ? FIXTURES[right] : undefined;
  const leftLines = lf?.lines ?? [];
  const rightLines = rf?.lines ?? [];
  return {
    left_lines: leftLines,
    right_lines: rightLines,
    left_ends_nl: lf?.ends ?? false,
    right_ends_nl: rf?.ends ?? false,
    ops: lineDiff(leftLines, rightLines),
    left_missing: !lf,
    right_missing: !rf,
    left_binary: false,
    right_binary: false,
  };
}
