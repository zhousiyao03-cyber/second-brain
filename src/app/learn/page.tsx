"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  GraduationCap,
  BookOpen,
  ChevronRight,
  Loader2,
  Sparkles,
  CheckCircle,
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

const categoryLabels: Record<string, string> = {
  backend: "后端开发",
  database: "数据库",
  devops: "DevOps",
  ai: "AI",
  "system-design": "系统设计",
};

const categoryColors: Record<string, string> = {
  backend: "bg-blue-100 text-blue-700",
  database: "bg-green-100 text-green-700",
  devops: "bg-orange-100 text-orange-700",
  ai: "bg-purple-100 text-purple-700",
  "system-design": "bg-rose-100 text-rose-700",
};

export default function LearnPage() {
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const utils = trpc.useUtils();
  const { data: paths = [], isLoading } = trpc.learning.listPaths.useQuery();
  const seedPresets = trpc.learning.seedPresets.useMutation({
    onSuccess: () => utils.learning.listPaths.invalidate(),
  });

  const { data: pathDetail } = trpc.learning.getPath.useQuery(
    { id: selectedPathId! },
    { enabled: !!selectedPathId }
  );

  const { data: lessonDetail } = trpc.learning.getLesson.useQuery(
    { id: selectedLessonId! },
    { enabled: !!selectedLessonId }
  );

  const completeLesson = trpc.learning.completeLesson.useMutation({
    onSuccess: () => {
      utils.learning.getPath.invalidate({ id: selectedPathId! });
      utils.learning.getLesson.invalidate({ id: selectedLessonId! });
    },
  });

  const handleGenerateLesson = async () => {
    if (!selectedPathId) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/generate-lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathId: selectedPathId }),
      });
      if (res.ok) {
        utils.learning.getPath.invalidate({ id: selectedPathId });
      }
    } finally {
      setGenerating(false);
    }
  };

  // Lesson detail view
  if (selectedLessonId && lessonDetail) {
    return (
      <div>
        <button
          onClick={() => setSelectedLessonId(null)}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-4"
        >
          <ArrowLeft size={14} />
          返回课程列表
        </button>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          {lessonDetail.title}
        </h1>
        <div className="flex items-center gap-2 mb-6">
          {lessonDetail.status === "completed" ? (
            <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
              <CheckCircle size={12} /> 已完成
            </span>
          ) : (
            <button
              onClick={() =>
                completeLesson.mutate({
                  id: selectedLessonId,
                  pathId: selectedPathId!,
                })
              }
              className="text-xs px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700"
            >
              标记完成
            </button>
          )}
        </div>
        <div className="prose prose-sm max-w-none mb-8">
          <div className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed">
            {lessonDetail.content}
          </div>
        </div>
        {lessonDetail.quiz && (
          <div className="border-t pt-6">
            <h2 className="text-lg font-semibold mb-4">练习题</h2>
            <div className="space-y-4">
              {JSON.parse(lessonDetail.quiz).map(
                (q: { question: string; answer: string }, i: number) => (
                  <div
                    key={i}
                    className="p-4 bg-gray-50 rounded-lg border border-gray-200"
                  >
                    <p className="font-medium text-sm text-gray-900 mb-2">
                      {i + 1}. {q.question}
                    </p>
                    <details className="text-sm text-gray-600">
                      <summary className="cursor-pointer text-blue-600 hover:text-blue-700">
                        查看答案
                      </summary>
                      <p className="mt-2 pl-2 border-l-2 border-blue-200">
                        {q.answer}
                      </p>
                    </details>
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Path detail view
  if (selectedPathId && pathDetail) {
    return (
      <div>
        <button
          onClick={() => {
            setSelectedPathId(null);
            setSelectedLessonId(null);
          }}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-4"
        >
          <ArrowLeft size={14} />
          返回学习路径
        </button>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {pathDetail.title}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {pathDetail.description}
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-blue-600">
              {pathDetail.progress ?? 0}%
            </div>
            <div className="text-xs text-gray-400">学习进度</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 bg-gray-100 rounded-full mb-6">
          <div
            className="h-2 bg-blue-600 rounded-full transition-all"
            style={{ width: `${pathDetail.progress ?? 0}%` }}
          />
        </div>

        {/* Lessons */}
        <div className="space-y-2 mb-6">
          {pathDetail.lessonList.map((lesson, i) => (
            <button
              key={lesson.id}
              onClick={() => setSelectedLessonId(lesson.id)}
              className="w-full flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 text-left"
            >
              <div
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0",
                  lesson.status === "completed"
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-100 text-gray-500"
                )}
              >
                {lesson.status === "completed" ? (
                  <CheckCircle size={14} />
                ) : (
                  i + 1
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">
                  {lesson.title}
                </div>
              </div>
              <ChevronRight size={14} className="text-gray-400" />
            </button>
          ))}
        </div>

        <button
          onClick={handleGenerateLesson}
          disabled={generating}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          {generating ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Sparkles size={16} />
          )}
          AI 生成下一课
        </button>
      </div>
    );
  }

  // Path list view
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">学习</h1>
        {paths.length === 0 && (
          <button
            onClick={() => seedPresets.mutate()}
            disabled={seedPresets.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {seedPresets.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Sparkles size={16} />
            )}
            初始化推荐路径
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-gray-500 text-sm">加载中...</p>
      ) : paths.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <GraduationCap size={48} className="mx-auto mb-3 opacity-50" />
          <p>还没有学习路径，点击初始化推荐路径开始</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {paths.map((path) => (
            <button
              key={path.id}
              onClick={() => setSelectedPathId(path.id)}
              className="p-5 border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-sm transition-all text-left"
            >
              <div className="flex items-start justify-between mb-3">
                <BookOpen size={20} className="text-blue-600 mt-0.5" />
                {path.category && (
                  <span
                    className={cn(
                      "text-xs px-2 py-0.5 rounded",
                      categoryColors[path.category] ?? "bg-gray-100 text-gray-600"
                    )}
                  >
                    {categoryLabels[path.category] ?? path.category}
                  </span>
                )}
              </div>
              <h3 className="font-medium text-gray-900 mb-1">{path.title}</h3>
              <p className="text-xs text-gray-500 line-clamp-2 mb-3">
                {path.description}
              </p>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full">
                  <div
                    className="h-1.5 bg-blue-600 rounded-full transition-all"
                    style={{ width: `${path.progress ?? 0}%` }}
                  />
                </div>
                <span className="text-xs text-gray-400">
                  {path.progress ?? 0}%
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
