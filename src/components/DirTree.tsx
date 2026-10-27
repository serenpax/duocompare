import { useState } from "react";
import type { SelectedFile, TreeNode } from "../types";
import { STATUS_LABEL } from "../types";

export type FilterKey = "diff" | "all" | "same" | "left" | "right";

function matches(node: TreeNode, filter: FilterKey): boolean {
  if (node.is_dir) {
    return node.children.some((c) => matches(c, filter));
  }
  switch (filter) {
    case "all":
      return true;
    case "diff":
      return node.status !== "same";
    case "same":
      return node.status === "same";
    case "left":
      return node.status === "left-only";
    case "right":
      return node.status === "right-only";
  }
}

interface Props {
  nodes: TreeNode[];
  filter: FilterKey;
  selectedKey: string | null;
  onSelect: (file: SelectedFile) => void;
}

export default function DirTree({ nodes, filter, selectedKey, onSelect }: Props) {
  return (
    <div className="tree">
      {nodes
        .filter((n) => matches(n, filter))
        .map((n) => (
          <TreeRow
            key={n.rel_path}
            node={n}
            depth={0}
            filter={filter}
            selectedKey={selectedKey}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

interface RowProps {
  node: TreeNode;
  depth: number;
  filter: FilterKey;
  selectedKey: string | null;
  onSelect: (file: SelectedFile) => void;
}

function TreeRow({ node, depth, filter, selectedKey, onSelect }: RowProps) {
  const [open, setOpen] = useState(true);

  if (node.is_dir) {
    return (
      <div className="tree-node">
        <div
          className="tree-row dir"
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => setOpen((o) => !o)}
        >
          <span className={`chevron ${open ? "open" : ""}`}>▶</span>
          <span className="tree-name">{node.name}</span>
          <span className={`chip s-${node.status}`}>{STATUS_LABEL[node.status]}</span>
        </div>
        {open &&
          node.children
            .filter((c) => matches(c, filter))
            .map((c) => (
              <TreeRow
                key={c.rel_path}
                node={c}
                depth={depth + 1}
                filter={filter}
                selectedKey={selectedKey}
                onSelect={onSelect}
              />
            ))}
      </div>
    );
  }

  const active = selectedKey === node.rel_path;
  return (
    <div
      className={`tree-row file ${active ? "active" : ""}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() =>
        onSelect({
          name: node.name,
          relPath: node.rel_path,
          status: node.status,
          left: node.left_path,
          right: node.right_path,
        })
      }
    >
      <span className="tree-name">{node.name}</span>
      <span className={`chip s-${node.status}`}>{STATUS_LABEL[node.status]}</span>
    </div>
  );
}
