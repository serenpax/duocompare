import { useEffect, useMemo, useRef, useState } from "react";
import { loadFileDiff, saveFile } from "../api";
import { lineDiff } from "../diff";
import type { DiffOp, FileDiff, SelectedFile } from "../types";
import { STATUS_LABEL } from "../types";

const ROW_H = 24;

interface DiffRow {
  l?: { no: number; text: string; changed: boolean };
  r?: { no: number; text: string; changed: boolean };
}

interface Block {
  rowStart: number;
  rowCount: number;
  leftStart: number;
  leftEnd: number;
  rightStart: number;
  rightEnd: number;
}

function buildRows(
  ops: DiffOp[],
  left: string[],
  right: string[],
): { rows: DiffRow[]; blocks: Block[] } {
  const rows: DiffRow[] = [];
  const blocks: Block[] = [];
  let current: Block | null = null;

  const closeBlock = () => {
    if (current) {
      current.rowCount = rows.length - current.rowStart;
      blocks.push(current);
      current = null;
    }
  };

  for (const op of ops) {
    const changed = op.kind !== "equal";
    if (changed) {
      if (!current) {
        current = {
          rowStart: rows.length,
          rowCount: 0,
          leftStart: op.old_start,
          leftEnd: op.old_start + op.old_len,
          rightStart: op.new_start,
          rightEnd: op.new_start + op.new_len,
        };
      }
      current.leftEnd = op.old_start + op.old_len;
      current.rightEnd = op.new_start + op.new_len;
    } else {
      closeBlock();
    }

    switch (op.kind) {
      case "equal":
        for (let k = 0; k < op.old_len; k++) {
          rows.push({
            l: { no: op.old_start + k + 1, text: left[op.old_start + k] ?? "", changed: false },
            r: { no: op.new_start + k + 1, text: right[op.new_start + k] ?? "", changed: false },
          });
        }
        break;
      case "delete":
        for (let k = 0; k < op.old_len; k++) {
          rows.push({
            l: { no: op.old_start + k + 1, text: left[op.old_start + k] ?? "", changed: true },
          });
        }
        break;
      case "insert":
        for (let k = 0; k < op.new_len; k++) {
          rows.push({
            r: { no: op.new_start + k + 1, text: right[op.new_start + k] ?? "", changed: true },
          });
        }
        break;
      case "replace": {
        const paired = Math.min(op.old_len, op.new_len);
        for (let k = 0; k < paired; k++) {
          rows.push({
            l: { no: op.old_start + k + 1, text: left[op.old_start + k] ?? "", changed: true },
            r: { no: op.new_start + k + 1, text: right[op.new_start + k] ?? "", changed: true },
          });
        }
        for (let k = paired; k < op.old_len; k++) {
          rows.push({
            l: { no: op.old_start + k + 1, text: left[op.old_start + k] ?? "", changed: true },
          });
        }
        for (let k = paired; k < op.new_len; k++) {
          rows.push({
            r: { no: op.new_start + k + 1, text: right[op.new_start + k] ?? "", changed: true },
          });
        }
        break;
      }
    }
  }
  closeBlock();
  return { rows, blocks };
}

function inlineMarks(a: string, b: string): { pre: number; aMid: number; bMid: number } | null {
  const ac = Array.from(a);
  const bc = Array.from(b);
  let pre = 0;
  while (pre < ac.length && pre < bc.length && ac[pre] === bc[pre]) pre++;
  let suf = 0;
  while (
    suf < ac.length - pre &&
    suf < bc.length - pre &&
    ac[ac.length - 1 - suf] === bc[bc.length - 1 - suf]
  ) {
    suf++;
  }
  if (pre + suf === 0) return null;
  return { pre, aMid: ac.length - pre - suf, bMid: bc.length - pre - suf };
}

function splitText(text: string, pre: number, mid: number): [string, string, string] {
  const chars = Array.from(text);
  return [
    chars.slice(0, pre).join(""),
    chars.slice(pre, pre + mid).join(""),
    chars.slice(pre + mid).join(""),
  ];
}

interface Props {
  file: SelectedFile;
}

export default function FileDiffView({ file }: Props) {
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [leftBuf, setLeftBuf] = useState<string[]>([]);
  const [rightBuf, setRightBuf] = useState<string[]>([]);
  const [leftEnds, setLeftEnds] = useState(false);
  const [rightEnds, setRightEnds] = useState(false);
  const [dirtyL, setDirtyL] = useState(false);
  const [dirtyR, setDirtyR] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const blockRefs = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => {
    let cancelled = false;
    setDiff(null);
    setError(null);
    setDirtyL(false);
    setDirtyR(false);
    setCursor(0);
    loadFileDiff(file.left, file.right)
      .then((d) => {
        if (cancelled) return;
        setDiff(d);
        setLeftBuf(d.left_lines);
        setRightBuf(d.right_lines);
        setLeftEnds(d.left_ends_nl);
        setRightEnds(d.right_ends_nl);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const ops = useMemo(() => lineDiff(leftBuf, rightBuf), [leftBuf, rightBuf]);
  const { rows, blocks } = useMemo(() => buildRows(ops, leftBuf, rightBuf), [ops, leftBuf, rightBuf]);

  const jumpTo = (idx: number) => {
    blockRefs.current.get(idx)?.scrollIntoView({ block: "center", behavior: "smooth" });
    setCursor(idx);
  };

  const copyToRight = (b: Block) => {
    setRightBuf([
      ...rightBuf.slice(0, b.rightStart),
      ...leftBuf.slice(b.leftStart, b.leftEnd),
      ...rightBuf.slice(b.rightEnd),
    ]);
    setDirtyR(true);
  };

  const copyToLeft = (b: Block) => {
    setLeftBuf([
      ...leftBuf.slice(0, b.leftStart),
      ...rightBuf.slice(b.rightStart, b.rightEnd),
      ...leftBuf.slice(b.leftEnd),
    ]);
    setDirtyL(true);
  };

  const saveLeft = async () => {
    if (!file.left) return;
    await saveFile(file.left, leftBuf, leftEnds);
    setDirtyL(false);
  };

  const saveRight = async () => {
    if (!file.right) return;
    await saveFile(file.right, rightBuf, rightEnds);
    setDirtyR(false);
  };

  const renderCode = (row: DiffRow, side: "l" | "r") => {
    const own = row[side];
    const other = row[side === "l" ? "r" : "l"];
    if (!own) return <span className="code" />;
    if (own.changed && other?.changed) {
      const marks = inlineMarks(side === "l" ? own.text : other.text, side === "l" ? other.text : own.text);
      if (marks) {
        const [pre, mid, suf] = splitText(own.text, marks.pre, side === "l" ? marks.aMid : marks.bMid);
        return (
          <span className="code">
            {pre}
            {mid && <mark className="inline">{mid}</mark>}
            {suf}
          </span>
        );
      }
    }
    return <span className="code">{own.text}</span>;
  };

  const binary = diff?.left_binary || diff?.right_binary;
  const bothPresent = file.left && file.right;

  return (
    <div className="diff-view">
      <div className="diff-header">
        <div className="diff-title">
          <span className="file-name">{file.name}</span>
          <span className={`chip s-${file.status}`}>{STATUS_LABEL[file.status]}</span>
          {dirtyL && <span className="dirty">左侧未保存</span>}
          {dirtyR && <span className="dirty">右侧未保存</span>}
        </div>
        <div className="diff-actions">
          <button className="btn" disabled={blocks.length === 0} onClick={() => jumpTo(Math.max(0, cursor - 1))}>
            上一个差异
          </button>
          <button
            className="btn"
            disabled={blocks.length === 0}
            onClick={() => jumpTo(Math.min(blocks.length - 1, cursor + 1))}
          >
            下一个差异
          </button>
          <span className="diff-count">{blocks.length ? `${blocks.length} 处差异` : "无差异"}</span>
          <button className="btn primary" disabled={!dirtyL || !file.left} onClick={saveLeft}>
            保存左侧
          </button>
          <button className="btn primary" disabled={!dirtyR || !file.right} onClick={saveRight}>
            保存右侧
          </button>
        </div>
      </div>

      <div className="diff-paths">
        <span className="path left-path">{file.left ?? "（左侧文件不存在）"}</span>
        <span />
        <span className="path right-path">{file.right ?? "（右侧文件不存在）"}</span>
      </div>

      {error && <div className="banner error">{error}</div>}
      {!error && binary && (
        <div className="banner">二进制或非 UTF-8 文件，暂不支持文本对比。</div>
      )}
      {!error && !binary && diff && rows.length > 0 && blocks.length === 0 && (
        <div className="banner ok">文件内容完全相同。</div>
      )}
      {!error && !binary && !bothPresent && diff && (
        <div className="banner">该文件仅存在于一侧，可查看内容；合并与保存需要两侧文件都存在。</div>
      )}

      {!error && !binary && diff && (
        <div className="diff-scroll">
          <div className="diff-grid">
            <div className="col col-left">
              {rows.map((row, i) => (
                <div key={i} className={`row ${row.l ? (row.l.changed ? "changed" : "") : "empty"}`}>
                  <span className="lnum">{row.l?.no ?? ""}</span>
                  {renderCode(row, "l")}
                </div>
              ))}
            </div>
            <div className="gutter" style={{ height: Math.max(rows.length * ROW_H, 120) }}>
              {blocks.map((b, i) => (
                <div
                  key={i}
                  ref={(el) => {
                    if (el) blockRefs.current.set(i, el);
                    else blockRefs.current.delete(i);
                  }}
                  className={`gutter-block ${i === cursor ? "active" : ""}`}
                  style={{ top: b.rowStart * ROW_H, height: b.rowCount * ROW_H }}
                  onClick={() => setCursor(i)}
                >
                  <button
                    className="merge-btn"
                    title="将左侧此差异块复制到右侧"
                    onClick={() => copyToRight(b)}
                  >
                    →
                  </button>
                  <button
                    className="merge-btn"
                    title="将右侧此差异块复制到左侧"
                    onClick={() => copyToLeft(b)}
                  >
                    ←
                  </button>
                </div>
              ))}
            </div>
            <div className="col col-right">
              {rows.map((row, i) => (
                <div key={i} className={`row ${row.r ? (row.r.changed ? "changed" : "") : "empty"}`}>
                  <span className="lnum">{row.r?.no ?? ""}</span>
                  {renderCode(row, "r")}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
