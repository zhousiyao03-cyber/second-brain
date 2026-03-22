"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Compass,
  Loader2,
  Sparkles,
  Bookmark,
  Tag,
  RefreshCw,
} from "lucide-react";

interface Recommendation {
  title: string;
  description: string;
  category: string;
  reason: string;
}

interface ExploreResult {
  interests: string[];
  recommendations: Recommendation[];
}

export default function ExplorePage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExploreResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const createBookmark = trpc.bookmarks.create.useMutation({
    onSuccess: () => utils.bookmarks.list.invalidate(),
  });

  const handleExplore = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/explore", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "请求失败");
      }
      const data = await res.json();
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "探索失败");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (rec: Recommendation, index: number) => {
    setSaving(index);
    try {
      await createBookmark.mutateAsync({
        title: rec.title,
        source: "text",
      });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">AI 探索</h1>
        <button
          onClick={handleExplore}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : result ? (
            <RefreshCw size={16} />
          ) : (
            <Sparkles size={16} />
          )}
          {result ? "重新探索" : "开始探索"}
        </button>
      </div>

      {!result && !loading && !error && (
        <div className="text-center py-12 text-gray-400">
          <Compass size={48} className="mx-auto mb-3 opacity-50" />
          <p>AI 会分析你的笔记、收藏和待办</p>
          <p className="text-sm mt-1">为你推荐感兴趣的学习资源和话题</p>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg mb-4">
          {error}。请检查本地模型服务是否启动，或 AI provider 配置是否正确。
        </div>
      )}

      {result && (
        <div className="space-y-6">
          {/* Interests */}
          <div>
            <h2 className="text-sm font-medium text-gray-500 mb-2">
              你可能感兴趣的方向
            </h2>
            <div className="flex flex-wrap gap-2">
              {result.interests.map((interest, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1 px-3 py-1.5 bg-purple-50 text-purple-700 text-sm rounded-full"
                >
                  <Tag size={12} />
                  {interest}
                </span>
              ))}
            </div>
          </div>

          {/* Recommendations */}
          <div>
            <h2 className="text-sm font-medium text-gray-500 mb-3">
              推荐内容
            </h2>
            <div className="space-y-3">
              {result.recommendations.map((rec, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 p-4 border border-gray-200 rounded-lg group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-900 text-sm">
                        {rec.title}
                      </h3>
                      <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">
                        {rec.category}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {rec.description}
                    </p>
                    <p className="text-xs text-purple-500 mt-1">
                      {rec.reason}
                    </p>
                  </div>
                  <button
                    onClick={() => handleSave(rec, i)}
                    disabled={saving === i}
                    className="p-2 text-gray-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-100"
                    title="收藏"
                  >
                    {saving === i ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Bookmark size={16} />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
