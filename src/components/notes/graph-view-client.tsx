"use client";

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useRouter } from "next/navigation";
import { ArrowLeft, ZoomIn, ZoomOut, Maximize } from "lucide-react";

interface GraphNode {
  id: string;
  title: string;
  icon: string | null;
  folderId: string | null;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

interface GraphEdge {
  source: string;
  target: string;
}

// Simple force-directed layout without D3 dependency
function applyForces(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number
) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Initialize positions if not set
  for (const node of nodes) {
    if (node.x === undefined) {
      node.x = width / 2 + (Math.random() - 0.5) * width * 0.6;
      node.y = height / 2 + (Math.random() - 0.5) * height * 0.6;
      node.vx = 0;
      node.vy = 0;
    }
  }

  const iterations = 100;
  const repulsion = 2000;
  const attraction = 0.005;
  const centerPull = 0.01;
  const damping = 0.9;

  for (let iter = 0; iter < iterations; iter++) {
    // Repulsion between all nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = (a.x ?? 0) - (b.x ?? 0);
        const dy = (a.y ?? 0) - (b.y ?? 0);
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = repulsion / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx = (a.vx ?? 0) + fx;
        a.vy = (a.vy ?? 0) + fy;
        b.vx = (b.vx ?? 0) - fx;
        b.vy = (b.vy ?? 0) - fy;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) continue;
      const dx = (b.x ?? 0) - (a.x ?? 0);
      const dy = (b.y ?? 0) - (a.y ?? 0);
      const fx = dx * attraction;
      const fy = dy * attraction;
      a.vx = (a.vx ?? 0) + fx;
      a.vy = (a.vy ?? 0) + fy;
      b.vx = (b.vx ?? 0) - fx;
      b.vy = (b.vy ?? 0) - fy;
    }

    // Center pull
    for (const node of nodes) {
      node.vx = (node.vx ?? 0) + ((width / 2 - (node.x ?? 0)) * centerPull);
      node.vy = (node.vy ?? 0) + ((height / 2 - (node.y ?? 0)) * centerPull);
    }

    // Apply velocities
    for (const node of nodes) {
      node.vx = (node.vx ?? 0) * damping;
      node.vy = (node.vy ?? 0) * damping;
      node.x = (node.x ?? 0) + (node.vx ?? 0);
      node.y = (node.y ?? 0) + (node.vy ?? 0);
    }
  }
}

// Deterministic color from folderId
function folderColor(folderId: string | null): string {
  if (!folderId) return "#94a3b8"; // stone-400
  const colors = [
    "#3b82f6", "#10b981", "#f59e0b", "#ef4444",
    "#8b5cf6", "#ec4899", "#06b6d4", "#f97316",
  ];
  let hash = 0;
  for (let i = 0; i < folderId.length; i++) {
    hash = ((hash << 5) - hash + folderId.charCodeAt(i)) | 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

export function GraphViewClient() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [zoom, setZoom] = useState(1);
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);

  const { data: graphData, isLoading } = trpc.notes.graphData.useQuery();
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Track container size changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!graphData || !canvasRef.current || !containerRef.current) return;
    if (containerSize.width === 0) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    // Copy data
    const nodes: GraphNode[] = graphData.nodes.map((n) => ({
      ...n,
      x: undefined,
      y: undefined,
      vx: 0,
      vy: 0,
    }));
    const edges: GraphEdge[] = [...graphData.edges];

    applyForces(nodes, edges, width, height);
    nodesRef.current = nodes;
    edgesRef.current = edges;

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // Draw
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-width / 2, -height / 2);

    // Draw edges
    ctx.strokeStyle = "rgba(148, 163, 184, 0.3)";
    ctx.lineWidth = 1;
    for (const edge of edges) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x ?? 0, a.y ?? 0);
      ctx.lineTo(b.x ?? 0, b.y ?? 0);
      ctx.stroke();
    }

    // Draw nodes
    const nodeRadius = 6;
    for (const node of nodes) {
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, nodeRadius, 0, Math.PI * 2);
      ctx.fillStyle = folderColor(node.folderId);
      ctx.fill();

      if (hoveredNode?.id === node.id) {
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // Draw labels for nodes with connections or hovered
    const connectedIds = new Set<string>();
    for (const e of edges) {
      connectedIds.add(e.source);
      connectedIds.add(e.target);
    }

    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (const node of nodes) {
      if (connectedIds.has(node.id) || hoveredNode?.id === node.id) {
        const label =
          (node.icon ? `${node.icon} ` : "") +
          (node.title || "Untitled").slice(0, 25);
        ctx.fillStyle =
          hoveredNode?.id === node.id ? "#1e293b" : "#64748b";
        ctx.fillText(label, node.x ?? 0, (node.y ?? 0) + nodeRadius + 14);
      }
    }

    ctx.restore();
  }, [graphData, zoom, hoveredNode, containerSize]);

  // Mouse interaction
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !containerRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const width = rect.width;
    const height = rect.height;

    // Reverse zoom transform
    const x = (mx - width / 2) / zoom + width / 2;
    const y = (my - height / 2) / zoom + height / 2;

    for (const node of nodesRef.current) {
      const dx = (node.x ?? 0) - x;
      const dy = (node.y ?? 0) - y;
      if (dx * dx + dy * dy < 100) {
        router.push(`/notes/${node.id}`);
        return;
      }
    }
  };

  const handleCanvasMouseMove = (
    e: React.MouseEvent<HTMLCanvasElement>
  ) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const width = rect.width;
    const height = rect.height;

    const x = (mx - width / 2) / zoom + width / 2;
    const y = (my - height / 2) / zoom + height / 2;

    let found: GraphNode | null = null;
    for (const node of nodesRef.current) {
      const dx = (node.x ?? 0) - x;
      const dy = (node.y ?? 0) - y;
      if (dx * dx + dy * dy < 100) {
        found = node;
        break;
      }
    }
    setHoveredNode(found);
  };

  return (
    <div className="flex h-[calc(100vh-120px)] flex-col">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/notes")}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
          >
            <ArrowLeft size={16} />
            Notes
          </button>
          <h1 className="text-xl font-bold text-stone-900 dark:text-stone-100">
            Graph View
          </h1>
          {graphData && (
            <span className="text-sm text-stone-400">
              {graphData.nodes.length} notes, {graphData.edges.length} links
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom((z) => Math.min(z + 0.2, 3))}
            className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            <ZoomIn size={16} />
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(z - 0.2, 0.3))}
            className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            <ZoomOut size={16} />
          </button>
          <button
            onClick={() => setZoom(1)}
            className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            <Maximize size={16} />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950"
      >
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-stone-400">
            Loading graph...
          </div>
        ) : graphData && graphData.nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-stone-400">
            No notes yet. Create some notes and link them with [[wiki-links]].
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="h-full w-full cursor-crosshair"
            onClick={handleCanvasClick}
            onMouseMove={handleCanvasMouseMove}
          />
        )}

        {/* Hover tooltip */}
        {hoveredNode && (
          <div className="pointer-events-none absolute left-4 top-4 rounded-lg border border-stone-200 bg-white/95 px-3 py-2 text-sm shadow-lg dark:border-stone-700 dark:bg-stone-900/95">
            <div className="flex items-center gap-2">
              {hoveredNode.icon && <span>{hoveredNode.icon}</span>}
              <span className="font-medium text-stone-900 dark:text-stone-100">
                {hoveredNode.title || "Untitled"}
              </span>
            </div>
            <div className="mt-1 text-xs text-stone-400">Click to open</div>
          </div>
        )}
      </div>
    </div>
  );
}
