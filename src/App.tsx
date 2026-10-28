import { useEffect, useMemo, useRef, useState } from "react";
import { compareDirs, isTauri, pickFolder } from "./api";
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
  const [dropSide, setDropSide] = useState<"left" | "right" | null>(null);
  const [dropDebug, setDropDebug] = useState<string>("");
  const leftGroupRef = useRef<HTMLDivElement>(null);
  const rightGroupRef = useRef<HTMLDivElement>(null);

  const runCompare = async (left?: string, right?: string) => {
    const l = (left ?? leftPath).trim();
    const r = (right ?? rightPath).trim();
    if (!l || !r) {
      setError("请先选择左右两个文件夹");
      return;
    }
    setBusy(true);
    setError(null);
    setSelected(null);
    try {
      setTree(await compareDirs(l, r));
    } catch (e) {
      setTree(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const swapSides = () => {
    setLeftPath(rightPath);
    setRightPath(leftPath);
    if (tree) void runCompare(rightPath, leftPath);
  };

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;

    const sideAt = (x: number, y: number): "left" | "right" | null => {
      const l = leftGroupRef.current?.getBoundingClientRect();
      const r = rightGroupRef.current?.getBoundingClientRect();
      const inRect = (rc: DOMRect | undefined) =>
        !!rc && x >= rc.left && x <= rc.right && y >= rc.top && y <= rc.bottom;
      if (l && r) {
        if (inRect(l)) return "left";
        if (inRect(r)) return "right";
        // 兜底：按 X 就近归一侧，y 偏差/落在间隙上也不会丢
        const lc = (l.left + l.right) / 2;
        const rc = (r.left + r.right) / 2;
        return Math.abs(x - lc) <= Math.abs(x - rc) ? "left" : "right";
      }
      return l ? "left" : r ? "right" : null;
    };

    // cursorPosition 与 innerPosition 同为全局物理像素，相减后即是窗口偏移；
    // 但 y 的基准是窗口顶部，需要再减去标题栏高度才与 getBoundingClientRect 同系。
    const sideFromCursor = async (
      win: {
        innerPosition: () => Promise<{ x: number; y: number }>;
        outerSize: () => Promise<{ width: number; height: number }>;
        innerSize: () => Promise<{ width: number; height: number }>;
        scaleFactor: () => Promise<number>;
      },
    ): Promise<{ side: "left" | "right" | null; css: { x: number; y: number } } | null> => {
      try {
        const { cursorPosition } = await import("@tauri-apps/api/window");
        const [cur, origin, sf, outer, inner] = await Promise.all([
          cursorPosition(),
          win.innerPosition(),
          win.scaleFactor(),
          win.outerSize(),
          win.innerSize(),
        ]);
        const s = sf || 1;
        const titlebar = (outer.height - inner.height) / s;
        const css = {
          x: (cur.x - origin.x) / s,
          y: (cur.y - origin.y) / s - titlebar,
        };
        return { side: sideAt(css.x, css.y), css };
      } catch {
        return null;
      }
    };

    (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();

      if (import.meta.env.DEV) {
        const refreshDebug = async () => {
          const l = leftGroupRef.current?.getBoundingClientRect();
          const r = rightGroupRef.current?.getBoundingClientRect();
          const fromCursor = await sideFromCursor(win);
          const selfL = l ? sideAt((l.left + l.right) / 2, (l.top + l.bottom) / 2) : "?";
          const selfR = r ? sideAt((r.left + r.right) / 2, (r.top + r.bottom) / 2) : "?";
          setDropDebug(
            `selftest L→${selfL} R→${selfR}\n` +
              `cursorCss=${fromCursor ? `${fromCursor.css.x.toFixed(1)},${fromCursor.css.y.toFixed(1)}` : "n/a"}\n` +
              `L=${l ? `${l.left.toFixed(0)},${l.top.toFixed(0)} ${l.width.toFixed(0)}x${l.height.toFixed(0)}` : "n/a"} ` +
              `R=${r ? `${r.left.toFixed(0)},${r.top.toFixed(0)} ${r.width.toFixed(0)}x${r.height.toFixed(0)}` : "n/a"}`,
          );
        };
        void refreshDebug();
        const timer = setInterval(() => void refreshDebug(), 1000);
        (window as unknown as { __dbgTimer?: number }).__dbgTimer = timer as unknown as number;
      }

      unlisten = await win.onDragDropEvent(async (event) => {
        const p = event.payload;
        if (p.type === "leave") {
          setDropSide(null);
          return;
        }
        const fallback = "position" in p ? { x: p.position.x, y: p.position.y } : { x: 0, y: 0 };
        let side: "left" | "right" | null = null;
        const fromCursor = await sideFromCursor(win);
        if (fromCursor) {
          side = fromCursor.side;
          if (import.meta.env.DEV) {
            setDropDebug(
              `event=${p.type} pos=${fallback.x.toFixed(0)},${fallback.y.toFixed(0)} ` +
                `cursorCss=${fromCursor.css.x.toFixed(0)},${fromCursor.css.y.toFixed(0)} ` +
                `side=${side}`,
            );
          }
        }
        if (!side) side = sideAt(fallback.x, fallback.y);

        if (p.type === "drop") {
          setDropSide(null);
          const path = p.paths[0];
          if (import.meta.env.DEV) {
            setDropDebug((d) => `${d}\ndrop path=${path ?? "-"} side=${side}`);
          }
          if (side && path) {
            if (side === "left") setLeftPath(path);
            else setRightPath(path);
          }
          return;
        }
        setDropSide(side);
      });
    })();
    return () => {
      unlisten?.();
      const t = (window as unknown as { __dbgTimer?: number }).__dbgTimer;
      if (t) clearInterval(t);
    };
  }, []);

  const stats = useMemo(() => (tree ? countFiles(tree) : null), [tree]);

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark">Δ</span>
          <span className="brand-name">DuoCompare</span>
        </div>
        <div
          ref={leftGroupRef}
          className={`path-group${dropSide === "left" ? " drag-over" : ""}`}
        >
          <input
            className="path-input"
            placeholder="左侧文件夹路径（可拖入）"
            value={leftPath}
            onChange={(e) => setLeftPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runCompare()}
          />
          <button className="btn" onClick={async () => setLeftPath((await pickFolder()) ?? leftPath)}>
            浏览…
          </button>
        </div>
        <button className="btn swap-btn" title="交换左右文件夹" disabled={busy} onClick={swapSides}>
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 8h14M15 5l3 3-3 3" />
            <path d="M20 16H6M9 13l-3 3 3 3" />
          </svg>
        </button>
        <div
          ref={rightGroupRef}
          className={`path-group${dropSide === "right" ? " drag-over" : ""}`}
        >
          <input
            className="path-input"
            placeholder="右侧文件夹路径（可拖入）"
            value={rightPath}
            onChange={(e) => setRightPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runCompare()}
          />
          <button className="btn" onClick={async () => setRightPath((await pickFolder()) ?? rightPath)}>
            浏览…
          </button>
        </div>
        <button className="btn primary compare" disabled={busy} onClick={() => runCompare()}>
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
                选择或拖入两个文件夹后点击「开始对比」。
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

      {import.meta.env.DEV && dropDebug && (
        <pre className="drop-debug">{dropDebug}</pre>
      )}
    </div>
  );
}
