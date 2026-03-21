"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Workflow,
  Plus,
  Trash2,
  Loader2,
  Sparkles,
  Play,
  ChevronRight,
  ArrowLeft,
  Circle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface WorkflowNode {
  id: string;
  type: string;
  label: string;
  config: Record<string, unknown>;
}

interface WorkflowEdge {
  from: string;
  to: string;
}

const nodeTypeColors: Record<string, string> = {
  trigger: "bg-yellow-100 text-yellow-700 border-yellow-300",
  fetch: "bg-blue-100 text-blue-700 border-blue-300",
  query: "bg-indigo-100 text-indigo-700 border-indigo-300",
  summarize: "bg-purple-100 text-purple-700 border-purple-300",
  classify: "bg-pink-100 text-pink-700 border-pink-300",
  tag: "bg-green-100 text-green-700 border-green-300",
  save: "bg-emerald-100 text-emerald-700 border-emerald-300",
};

export default function WorkflowsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [running, setRunning] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const { data: workflowsList = [], isLoading } = trpc.workflows.list.useQuery();
  const seedPresets = trpc.workflows.seedPresets.useMutation({
    onSuccess: () => utils.workflows.list.invalidate(),
  });
  const createWorkflow = trpc.workflows.create.useMutation({
    onSuccess: () => {
      utils.workflows.list.invalidate();
      setNewName("");
      setNewDesc("");
      setShowCreateForm(false);
    },
  });
  const deleteWorkflow = trpc.workflows.delete.useMutation({
    onSuccess: () => {
      utils.workflows.list.invalidate();
      if (selectedId) setSelectedId(null);
    },
  });

  const { data: selectedWorkflow } = trpc.workflows.get.useQuery(
    { id: selectedId! },
    { enabled: !!selectedId }
  );

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    createWorkflow.mutate({
      name: newName.trim(),
      description: newDesc.trim() || undefined,
    });
  };

  const handleRun = async (id: string) => {
    setRunning(id);
    // Simulate workflow execution (real execution would require backend engine)
    await new Promise((r) => setTimeout(r, 2000));
    setRunning(null);
  };

  // Detail view
  if (selectedId && selectedWorkflow) {
    const nodes: WorkflowNode[] = selectedWorkflow.nodes
      ? JSON.parse(selectedWorkflow.nodes)
      : [];
    const edges: WorkflowEdge[] = selectedWorkflow.edges
      ? JSON.parse(selectedWorkflow.edges)
      : [];

    // Build ordered node list following edges
    const orderedNodes: WorkflowNode[] = [];
    if (nodes.length > 0) {
      const edgeMap = new Map(edges.map((e) => [e.from, e.to]));
      const startNodes = nodes.filter(
        (n) => !edges.some((e) => e.to === n.id)
      );
      let current = startNodes[0];
      const visited = new Set<string>();
      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        orderedNodes.push(current);
        const nextId = edgeMap.get(current.id);
        current = nextId ? nodes.find((n) => n.id === nextId)! : undefined!;
      }
      // Add any remaining unconnected nodes
      for (const n of nodes) {
        if (!visited.has(n.id)) orderedNodes.push(n);
      }
    }

    return (
      <div>
        <button
          onClick={() => setSelectedId(null)}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-4"
        >
          <ArrowLeft size={14} />
          返回工作流列表
        </button>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {selectedWorkflow.name}
            </h1>
            {selectedWorkflow.description && (
              <p className="text-sm text-gray-500 mt-1">
                {selectedWorkflow.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "px-2 py-1 text-xs rounded",
                selectedWorkflow.status === "active"
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-500"
              )}
            >
              {selectedWorkflow.status === "active" ? "活跃" : "草稿"}
            </span>
            <button
              onClick={() => handleRun(selectedWorkflow.id)}
              disabled={running === selectedWorkflow.id}
              className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
            >
              {running === selectedWorkflow.id ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
              运行
            </button>
          </div>
        </div>

        {/* Node pipeline visualization */}
        <div className="space-y-0">
          {orderedNodes.map((node, i) => (
            <div key={node.id}>
              <div
                className={cn(
                  "flex items-center gap-3 p-4 rounded-lg border",
                  nodeTypeColors[node.type] ?? "bg-gray-50 border-gray-200"
                )}
              >
                <Circle size={8} className="flex-shrink-0" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{node.label}</div>
                  <div className="text-xs opacity-70">{node.type}</div>
                </div>
              </div>
              {i < orderedNodes.length - 1 && (
                <div className="flex justify-center py-1">
                  <ChevronRight
                    size={16}
                    className="text-gray-300 rotate-90"
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {nodes.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">
            此工作流还没有节点
          </div>
        )}
      </div>
    );
  }

  // List view
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">工作流</h1>
        <div className="flex items-center gap-2">
          {workflowsList.length === 0 && (
            <button
              onClick={() => seedPresets.mutate()}
              disabled={seedPresets.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors text-sm"
            >
              {seedPresets.isPending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Sparkles size={16} />
              )}
              加载模板
            </button>
          )}
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
          >
            <Plus size={16} />
            新建
          </button>
        </div>
      </div>

      {showCreateForm && (
        <form
          onSubmit={handleCreate}
          className="mb-6 p-4 border border-gray-200 rounded-lg bg-gray-50"
        >
          <div className="space-y-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="工作流名称"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="描述（可选）"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!newName.trim() || createWorkflow.isPending}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                创建
              </button>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-100"
              >
                取消
              </button>
            </div>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="text-gray-500 text-sm">加载中...</p>
      ) : workflowsList.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Workflow size={48} className="mx-auto mb-3 opacity-50" />
          <p>还没有工作流，创建一个或加载模板</p>
        </div>
      ) : (
        <div className="space-y-2">
          {workflowsList.map((wf) => (
            <div
              key={wf.id}
              className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg group cursor-pointer hover:bg-gray-50"
              onClick={() => setSelectedId(wf.id)}
            >
              <Workflow size={16} className="text-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-gray-900 text-sm truncate">
                    {wf.name}
                  </h3>
                  <span
                    className={cn(
                      "px-1.5 py-0.5 text-xs rounded",
                      wf.status === "active"
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-500"
                    )}
                  >
                    {wf.status === "active" ? "活跃" : "草稿"}
                  </span>
                </div>
                {wf.description && (
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {wf.description}
                  </p>
                )}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRun(wf.id);
                }}
                disabled={running === wf.id}
                className="p-1.5 text-gray-400 hover:text-green-600 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-100"
                title="运行"
              >
                {running === wf.id ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Play size={16} />
                )}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteWorkflow.mutate({ id: wf.id });
                }}
                className="p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                title="删除"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
