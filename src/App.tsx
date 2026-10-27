import { useMemo, useState } from "react";
import { compareDirs, pickFolder } from "./api";
import DirTree, { type FilterKey } from "./components/DirTree";
import FileDiffView from "./components/FileDiffView";
import type { SelectedFile, TreeNode } from "./types";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "diff", label: "有差异" },
  { key: "all", label: "全部" },
  { key: "left", label: "仅左侧" },
  { key: "right", label: "仅右侧" },
  { key: "same", label: "相同" },
];

function countFiles(nodes: TreeNode[]): Record<string, number> {
  const stats: Record<string, number> = { modified: 0, "left-only": 0, "right-only": 0, same: 0 };
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      if (n.is_dir) walk(n.children);
      else stats[n.status] = (stats[n.status] ?? 0) + 1;
    }
  };
  walk(nodes);
  return stats;
}

export default function App() {
  const [leftPath, setLeftPath] = useState("");
  const [rightPath, setRightPath] = useState("");
  const [tree, setTree] = useState<TreeNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("diff");
  const [selected, setSelected] = useState<SelectedFile | null>(null);

  const runCompare = async () => {
    if (!leftPath.trim() || !rightPath.trim()) {
      setError("请先选择左右两个文件夹");
      return;
    }
    setBusy(true);
    setError(null);
    setSelected(null);
    try {
      setTree(await compareDirs(leftPath.trim(), rightPath.trim()));
    } catch (e) {
      setTree(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const stats = useMemo(() => (tree ? countFiles(tree) : null), [tree]);

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark">Δ</span>
          <span className="brand-name">DuoCompare</span>
        </div>
        <div className="path-group">
          <input
            className="path-input"
            placeholder="左侧文件夹路径"
            value={leftPath}
            onChange={(e) => setLeftPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runCompare()}
          />
          <button className="btn" onClick={async () => setLeftPath((await pickFolder()) ?? leftPath)}>
            浏览…
          </button>
        </div>
        <span className="vs">对比</span>
        <div className="path-group">
          <input
            className="path-input"
            placeholder="右侧文件夹路径"
            value={rightPath}
            onChange={(e) => setRightPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runCompare()}
          />
          <button className="btn" onClick={async () => setRightPath((await pickFolder()) ?? rightPath)}>
            浏览…
          </button>
        </div>
        <button className="btn primary compare" disabled={busy} onClick={runCompare}>
          {busy ? "对比中…" : "开始对比"}
        </button>
        {stats && (
          <div className="stats">
            <span className={`chip s-modified`}>差异 {stats.modified}</span>
            <span className={`chip s-left-only`}>仅左侧 {stats["left-only"]}</span>
            <span className={`chip s-right-only`}>仅右侧 {stats["right-only"]}</span>
            <span className={`chip s-same`}>相同 {stats.same}</span>
          </div>
        )}
      </header>

      {error && <div className="banner error">{error}</div>}

      <main className="main">
        <aside className="tree-panel">
          <div className="filter-bar">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={`filter ${filter === f.key ? "active" : ""}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="tree-scroll">
            {tree ? (
              <DirTree
                nodes={tree}
                filter={filter}
                selectedKey={selected?.relPath ?? null}
                onSelect={setSelected}
              />
            ) : (
              <div className="empty-tip">
                选择两个文件夹后点击「开始对比」。
                <br />
                <br />
                对比结果会以目录树展示，点击文件查看并排差异，用中间的 ← → 按钮手动合并。
              </div>
            )}
          </div>
        </aside>

        <section className="diff-panel">
          {selected ? (
            <FileDiffView key={`${selected.left}|${selected.right}`} file={selected} />
          ) : (
            <div className="empty-tip large">
              <div className="empty-symbol">Δ</div>
              <p>从左侧目录树选择一个文件</p>
              <p className="muted">代码对比 · 手动合并 · 一键保存</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
