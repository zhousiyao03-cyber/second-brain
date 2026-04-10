"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Calendar,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock3,
  Inbox,
  Plus,
  Search,
  SunMedium,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  Priority,
  Status,
  ViewMode,
  TodoBucket,
  TodoItem,
  TodoDraft,
  TodoEditorDraft,
} from "./types";
import {
  EMPTY_DRAFT,
  CATEGORY_OPTIONS,
  TIME_OPTIONS,
  priorityMeta,
  statusMeta,
  bucketMeta,
} from "./constants";
import {
  toLocalDateTimeValue,
  getDatePart,
  getTimePart,
  joinDateAndTime,
  getQuickDueValue,
  fromLocalDateTimeValue,
  formatAbsoluteDate,
  formatRelativeDueDate,
  getTodoBucket,
  getBucketFromDueDate,
  sortTodos,
  sortBacklogTodos,
  toEditorDraft,
} from "./utils";

export default function TodosPage() {
  const [draft, setDraft] = useState<TodoDraft>(EMPTY_DRAFT);
  const [showCreateDetails, setShowCreateDetails] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const [editorDraft, setEditorDraft] = useState<TodoEditorDraft | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<TodoBucket, boolean>>({
    overdue: true,
    today: true,
    upcoming: true,
    noDate: false,
    completed: false,
  });

  const utils = trpc.useUtils();
  const { data: todoResult, isLoading } = trpc.todos.list.useQuery();
  const todos = (todoResult?.items ?? []) as TodoItem[];

  const createTodo = trpc.todos.create.useMutation({
    onSuccess: ({ id }, variables) => {
      const createdDueDate =
        variables.dueDate instanceof Date ? variables.dueDate : null;
      const createdBucket = getBucketFromDueDate(createdDueDate);

      void utils.todos.list.invalidate();
      setStatusFilter("all");
      setPriorityFilter("all");
      setCategoryFilter("all");
      setQuery("");
      setSelectedTodoId(id);
      setEditorDraft({
        title: variables.title,
        description: variables.description ?? "",
        priority: variables.priority ?? "medium",
        category: variables.category ?? "",
        dueDate: toLocalDateTimeValue(createdDueDate),
        status: "todo",
      });
      setExpandedSections((current) => ({
        ...current,
        [createdBucket]: true,
      }));
      setDraft(EMPTY_DRAFT);
      setShowCreateDetails(false);
    },
  });

  const updateTodo = trpc.todos.update.useMutation({
    onSuccess: () => void utils.todos.list.invalidate(),
  });

  const deleteTodo = trpc.todos.delete.useMutation({
    onSuccess: (_, variables) => {
      void utils.todos.list.invalidate();
      if (variables.id === selectedTodoId) {
        setSelectedTodoId(null);
        setEditorDraft(null);
      }
    },
  });

  const selectedTodo =
    todos.find((todo) => todo.id === selectedTodoId) ?? null;

  const syncSelectedEditorDraft = (
    todoId: string,
    patch: Partial<TodoEditorDraft>
  ) => {
    if (selectedTodoId === todoId && editorDraft) {
      setEditorDraft({ ...editorDraft, ...patch });
    }
  };

  const categories = Array.from(
    new Set([
      ...CATEGORY_OPTIONS,
      ...todos
        .map((todo) => todo.category?.trim())
        .filter((value): value is string => Boolean(value)),
    ])
  );

  const filteredTodos = todos.filter((todo) => {
    const haystack = [todo.title, todo.description, todo.category]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const matchesQuery = !query || haystack.includes(query.trim().toLowerCase());
    const matchesStatus =
      statusFilter === "all" || (todo.status ?? "todo") === statusFilter;
    const matchesPriority =
      priorityFilter === "all" || (todo.priority ?? "medium") === priorityFilter;
    const matchesCategory =
      categoryFilter === "all" || (todo.category ?? "") === categoryFilter;

    return matchesQuery && matchesStatus && matchesPriority && matchesCategory;
  });

  const groupedTodos = {
    overdue: sortTodos(
      filteredTodos.filter((todo) => getTodoBucket(todo) === "overdue")
    ),
    today: sortTodos(
      filteredTodos.filter((todo) => getTodoBucket(todo) === "today")
    ),
    upcoming: sortTodos(
      filteredTodos.filter((todo) => getTodoBucket(todo) === "upcoming")
    ),
    noDate: sortBacklogTodos(
      filteredTodos.filter((todo) => getTodoBucket(todo) === "noDate")
    ),
    completed: sortBacklogTodos(
      filteredTodos.filter((todo) => getTodoBucket(todo) === "completed")
    ),
  };
  const tableTodos = [
    ...groupedTodos.overdue,
    ...groupedTodos.today,
    ...groupedTodos.upcoming,
    ...groupedTodos.noDate,
    ...groupedTodos.completed,
  ];

  const nextDueTodo =
    sortTodos(
      todos.filter(
        (todo) => (todo.status ?? "todo") !== "done" && Boolean(todo.dueDate)
      )
    )[0] ?? null;

  const handleCreate = (event: React.FormEvent) => {
    event.preventDefault();

    if (!draft.title.trim()) return;

    createTodo.mutate({
      title: draft.title.trim(),
      description: draft.description.trim() || undefined,
      priority: draft.priority,
      category: draft.category.trim() || undefined,
      dueDate: fromLocalDateTimeValue(draft.dueDate),
    });
  };

  const handleSaveSelectedTodo = () => {
    if (!selectedTodoId || !editorDraft || !editorDraft.title.trim()) return;

    updateTodo.mutate({
      id: selectedTodoId,
      title: editorDraft.title.trim(),
      description: editorDraft.description.trim() || null,
      priority: editorDraft.priority,
      status: editorDraft.status,
      category: editorDraft.category.trim() || null,
      dueDate: fromLocalDateTimeValue(editorDraft.dueDate) ?? null,
    });
  };

  const sectionConfigs = [
    {
      key: "overdue",
      title: "逾期",
      subtitle: "优先处理已经过点的任务",
      items: groupedTodos.overdue,
      empty: "没有逾期任务",
      icon: TriangleAlert,
      panelTone:
        "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950",
      iconTone:
        "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
      countTone:
        "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
    },
    {
      key: "today",
      title: "今天",
      subtitle: "今天要收口的任务",
      items: groupedTodos.today,
      empty: "今天没有到期任务",
      icon: SunMedium,
      panelTone:
        "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950",
      iconTone:
        "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
      countTone:
        "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    },
    {
      key: "upcoming",
      title: "即将到来",
      subtitle: "接下来已经排上时间的任务",
      items: groupedTodos.upcoming,
      empty: "接下来没有排期任务",
      icon: Clock3,
      panelTone:
        "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950",
      iconTone:
        "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
      countTone:
        "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
    },
    {
      key: "noDate",
      title: "无时间",
      subtitle: "还没放进时间表的事项",
      items: groupedTodos.noDate,
      empty: "所有任务都安排了时间",
      icon: Inbox,
      panelTone:
        "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950",
      iconTone:
        "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300",
      countTone:
        "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300",
    },
    {
      key: "completed",
      title: "已完成",
      subtitle: "完成后留档，不再抢占注意力",
      items: groupedTodos.completed,
      empty: "还没有完成的任务",
      icon: CheckCheck,
      panelTone:
        "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950",
      iconTone:
        "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
      countTone:
        "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    },
  ] as const;

  const openTaskCount =
    groupedTodos.overdue.length +
    groupedTodos.today.length +
    groupedTodos.upcoming.length +
    groupedTodos.noDate.length;
  const hasOpenEditor = Boolean(selectedTodo && editorDraft);
  const summaryCards = [
    {
      key: "open",
      label: "待处理",
      value: openTaskCount,
      helper: "还有多少件在路上",
    },
    {
      key: "today",
      label: "今天",
      value: groupedTodos.today.length,
      helper: bucketMeta.today.summary,
    },
    {
      key: "overdue",
      label: "逾期",
      value: groupedTodos.overdue.length,
      helper: bucketMeta.overdue.summary,
    },
    {
      key: "done",
      label: "已完成",
      value: groupedTodos.completed.length,
      helper: bucketMeta.completed.summary,
    },
  ] as const;

  useEffect(() => {
    if (!selectedTodoId) return;

    const row = document.querySelector<HTMLElement>(
      `[data-todo-id="${selectedTodoId}"]`
    );

    if (!row) return;

    row.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [selectedTodoId, todos.length]);

  const toggleDone = (todo: TodoItem) => {
    const current = (todo.status ?? "todo") as Status;
    const next = current === "done" ? "todo" : "done";

    updateTodo.mutate({ id: todo.id, status: next });
    syncSelectedEditorDraft(todo.id, { status: next });
  };

  const toggleInProgress = (todo: TodoItem) => {
    const current = (todo.status ?? "todo") as Status;
    if (current === "done") return;

    const next = current === "in_progress" ? "todo" : "in_progress";
    updateTodo.mutate({ id: todo.id, status: next });
    syncSelectedEditorDraft(todo.id, { status: next });
  };

  const handleInlineStatusChange = (todo: TodoItem, next: Status) => {
    if ((todo.status ?? "todo") === next) return;
    updateTodo.mutate({ id: todo.id, status: next });
    syncSelectedEditorDraft(todo.id, { status: next });
  };

  const handleInlinePriorityChange = (todo: TodoItem, next: Priority) => {
    if ((todo.priority ?? "medium") === next) return;
    updateTodo.mutate({ id: todo.id, priority: next });
    syncSelectedEditorDraft(todo.id, { priority: next });
  };

  return (
    <div className="space-y-6 pb-10 font-[family:var(--font-geist-sans)]">
      <div
        className={cn(
          "grid gap-6",
          hasOpenEditor && "xl:grid-cols-[minmax(0,1.65fr)_360px]"
        )}
      >
        <div className="space-y-6">
          <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-2xl">
                <h1 className="text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
                  Todo
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                  先把任务录进来，再决定是像数据库一样逐条管理，还是像执行面板一样盯住今天。
                </p>
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                  {nextDueTodo
                    ? `下一件有明确时间的任务是「${nextDueTodo.title}」。`
                    : "如果任务还没上时间，先安排今天最重要的一件。"}
                </p>
              </div>
              <div className="space-y-3">
                <div className="inline-flex rounded-[18px] border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900">
                  <button
                    type="button"
                    aria-pressed={viewMode === "table"}
                    onClick={() => setViewMode("table")}
                    className={cn(
                      "rounded-[14px] px-4 py-2 text-sm font-medium transition",
                      viewMode === "table"
                        ? "bg-white text-slate-950 shadow-sm dark:bg-slate-950 dark:text-white"
                        : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                    )}
                  >
                    表格
                  </button>
                  <button
                    type="button"
                    aria-pressed={viewMode === "dashboard"}
                    onClick={() => setViewMode("dashboard")}
                    className={cn(
                      "rounded-[14px] px-4 py-2 text-sm font-medium transition",
                      viewMode === "dashboard"
                        ? "bg-white text-slate-950 shadow-sm dark:bg-slate-950 dark:text-white"
                        : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                    )}
                  >
                    Dashboard
                  </button>
                </div>
                <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">
                  表格适合批量改状态和优先级，Dashboard 适合按逾期、今天和之后来收口。
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {summaryCards.map((card) => (
                <div
                  key={card.key}
                  className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4 dark:border-slate-800 dark:bg-slate-900/60"
                >
                  <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
                    {card.label}
                  </div>
                  <div className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
                    {card.value}
                  </div>
                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    {card.helper}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <form
            onSubmit={handleCreate}
            className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                  快速录入
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  先把事情扔进系统，再决定它是否值得排进时间表。
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 xl:flex-row">
              <div className="flex-1 rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
                <label
                  htmlFor="todo-title"
                  className="mb-2 block text-xs font-medium text-slate-500 dark:text-slate-400"
                >
                  任务标题
                </label>
                <input
                  id="todo-title"
                  type="text"
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, title: event.target.value }))
                  }
                  placeholder="添加新任务..."
                  aria-label="Todo 标题"
                  className="w-full bg-transparent text-lg font-medium tracking-[-0.03em] text-slate-950 outline-none placeholder:text-slate-400 dark:text-white"
                />
              </div>

              <div className="flex flex-col gap-2 sm:flex-row xl:items-stretch">
                <button
                  type="button"
                  onClick={() => setShowCreateDetails((current) => !current)}
                  className="inline-flex items-center justify-center gap-2 rounded-[22px] border border-slate-200 px-5 py-4 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                >
                  {showCreateDetails ? (
                    <>
                      收起字段 <ChevronUp size={16} />
                    </>
                  ) : (
                    <>
                      更多字段 <ChevronDown size={16} />
                    </>
                  )}
                </button>
                <button
                  type="submit"
                  disabled={!draft.title.trim() || createTodo.isPending}
                  className="inline-flex items-center justify-center gap-2 rounded-[22px] bg-slate-950 px-5 py-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                >
                  <Plus size={16} />
                  添加
                </button>
              </div>
            </div>

            {showCreateDetails && (
              <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 dark:border-slate-800 md:grid-cols-2">
                <textarea
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  rows={3}
                  placeholder="补充描述，方便以后接着做"
                  aria-label="Todo 描述"
                  className="md:col-span-2 rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-sky-700 dark:focus:ring-sky-950"
                />
                <select
                  value={draft.category}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      category: event.target.value,
                    }))
                  }
                  aria-label="Todo 分类"
                  className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-sky-700 dark:focus:ring-sky-950"
                >
                  <option value="">未分类</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <select
                  value={draft.priority}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      priority: event.target.value as Priority,
                    }))
                  }
                  aria-label="Todo 优先级"
                  className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-sky-700 dark:focus:ring-sky-950"
                >
                  <option value="low">低优先级</option>
                  <option value="medium">中优先级</option>
                  <option value="high">高优先级</option>
                </select>
                <div className="md:col-span-2 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: "今天", offset: 0, time: "18:00" },
                      { label: "明天", offset: 1, time: "09:00" },
                      { label: "下周", offset: 7, time: "09:00" },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            dueDate: getQuickDueValue(preset.offset, preset.time),
                          }))
                        }
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                      >
                        {preset.label}
                      </button>
                    ))}
                    {draft.dueDate && (
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((current) => ({ ...current, dueDate: "" }))
                        }
                        className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <X size={14} />
                        清空时间
                      </button>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
                    <label className="flex items-center gap-2 rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                      <Calendar size={16} className="text-slate-400" />
                      <input
                        type="date"
                        value={getDatePart(draft.dueDate)}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            dueDate: joinDateAndTime(
                              event.target.value,
                              getTimePart(current.dueDate) || "09:00"
                            ),
                          }))
                        }
                        aria-label="Todo 截止时间"
                        className="w-full bg-transparent text-slate-900 outline-none dark:text-white"
                      />
                    </label>
                    <select
                      value={getTimePart(draft.dueDate) || "09:00"}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          dueDate: current.dueDate
                            ? joinDateAndTime(
                                getDatePart(current.dueDate),
                                event.target.value
                              )
                            : current.dueDate,
                        }))
                      }
                      aria-label="Todo 截止时刻"
                      disabled={!draft.dueDate}
                      className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-sky-700 dark:focus:ring-sky-950"
                    >
                      {TIME_OPTIONS.map((time) => (
                        <option key={time} value={time}>
                          {time}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </form>

          <div className="space-y-4">
            <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-white">
                    筛选
                  </div>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    过滤视图，不改变任务本身。
                  </p>
                </div>
                <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                  {filteredTodos.length} 个结果
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_repeat(3,minmax(0,0.82fr))]">
                <label className="flex items-center gap-2 rounded-[20px] border border-slate-200 bg-slate-50/85 px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
                  <Search size={16} />
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索标题、描述或分类"
                    aria-label="搜索任务"
                    className="w-full bg-transparent text-slate-900 outline-none placeholder:text-slate-400 dark:text-white"
                  />
                </label>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  aria-label="按状态筛选"
                  className="rounded-[20px] border border-slate-200 bg-slate-50/85 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-sky-700 dark:focus:ring-sky-950"
                >
                  <option value="all">全部状态</option>
                  <option value="todo">待办</option>
                  <option value="in_progress">进行中</option>
                  <option value="done">已完成</option>
                </select>
                <select
                  value={priorityFilter}
                  onChange={(event) => setPriorityFilter(event.target.value)}
                  aria-label="按优先级筛选"
                  className="rounded-[20px] border border-slate-200 bg-slate-50/85 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-sky-700 dark:focus:ring-sky-950"
                >
                  <option value="all">全部优先级</option>
                  <option value="high">高优先级</option>
                  <option value="medium">中优先级</option>
                  <option value="low">低优先级</option>
                </select>
                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                  aria-label="按分类筛选"
                  className="rounded-[20px] border border-slate-200 bg-slate-50/85 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-sky-700 dark:focus:ring-sky-950"
                >
                  <option value="all">全部分类</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {!hasOpenEditor && (
              <div className="rounded-[20px] border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                {viewMode === "table"
                  ? "表格里可以直接改状态和优先级，点一行再补充详情。"
                  : "Dashboard 里按分组收任务，点卡片补充详情，点左侧圆圈直接完成。"}
              </div>
            )}

            {isLoading ? (
              <div className="rounded-[28px] border border-dashed border-slate-200 bg-white/80 px-6 py-16 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                加载中...
              </div>
            ) : filteredTodos.length === 0 ? (
              <div className="rounded-[28px] border border-dashed border-slate-200 bg-white/80 px-6 py-16 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                {todos.length === 0
                  ? "还没有任务，先把第一个任务记下来。"
                  : "当前筛选条件下没有匹配的任务。"}
              </div>
            ) : (
              viewMode === "table" ? (
                <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                    <div>
                      <h2 className="text-base font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                        表格视图
                      </h2>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        像数据库一样逐条管理，常用属性尽量在表格里直接完成。
                      </p>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      点击一行补充完整详情
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-[980px] w-full text-sm">
                      <thead className="bg-slate-50/90 dark:bg-slate-900/70">
                        <tr className="text-left text-xs font-medium text-slate-500 dark:text-slate-400">
                          <th className="w-16 px-5 py-3">完成</th>
                          <th className="px-5 py-3">任务</th>
                          <th className="w-40 px-5 py-3">状态</th>
                          <th className="w-36 px-5 py-3">优先级</th>
                          <th className="w-32 px-5 py-3">分类</th>
                          <th className="w-48 px-5 py-3">截止时间</th>
                          <th className="w-28 px-5 py-3">分组</th>
                          <th className="w-16 px-5 py-3 text-right">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tableTodos.map((todo) => {
                          const status = (todo.status ?? "todo") as Status;
                          const priority = (todo.priority ?? "medium") as Priority;
                          const dueMeta = formatRelativeDueDate(todo.dueDate);
                          const bucket = getTodoBucket(todo);
                          const CompletionIcon =
                            status === "done" ? CheckCircle2 : Circle;

                          return (
                            <tr
                              key={todo.id}
                              data-todo-id={todo.id}
                              onClick={() => {
                                setSelectedTodoId(todo.id);
                                setEditorDraft(toEditorDraft(todo));
                              }}
                              className={cn(
                                "cursor-pointer border-t border-slate-100 transition hover:bg-slate-50/80 dark:border-slate-800 dark:hover:bg-slate-900/60",
                                selectedTodoId === todo.id &&
                                  "bg-sky-50/70 dark:bg-sky-950/20"
                              )}
                            >
                              <td className="px-5 py-3 align-top">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleDone(todo);
                                  }}
                                  title={status === "done" ? "恢复为待办" : "标记完成"}
                                  aria-label={
                                    status === "done"
                                      ? `恢复为待办 ${todo.title}`
                                      : `标记完成 ${todo.title}`
                                  }
                                  className={cn(
                                    "grid size-9 place-items-center rounded-full border transition",
                                    status === "done"
                                      ? statusMeta.done.buttonTone
                                      : "border-slate-200 bg-white text-slate-400 hover:border-emerald-300 hover:text-emerald-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-500 dark:hover:border-emerald-700 dark:hover:text-emerald-300"
                                  )}
                                >
                                  <CompletionIcon
                                    size={18}
                                    className={cn(status === "done" && "text-emerald-500")}
                                  />
                                </button>
                              </td>
                              <td className="px-5 py-3 align-top">
                                <div className="max-w-[320px] min-w-0">
                                  <div
                                    className={cn(
                                      "font-medium text-slate-950 dark:text-white",
                                      status === "done" &&
                                        "text-slate-400 line-through dark:text-slate-500"
                                    )}
                                  >
                                    {todo.title}
                                  </div>
                                  {todo.description && (
                                    <p className="mt-1 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
                                      {todo.description}
                                    </p>
                                  )}
                                </div>
                              </td>
                              <td className="px-5 py-3 align-top">
                                <select
                                  value={status}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={(event) =>
                                    handleInlineStatusChange(
                                      todo,
                                      event.target.value as Status
                                    )
                                  }
                                  aria-label={`设置 ${todo.title} 状态`}
                                  className="w-full rounded-[14px] border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-sky-700 dark:focus:ring-sky-950"
                                >
                                  <option value="todo">待办</option>
                                  <option value="in_progress">进行中</option>
                                  <option value="done">已完成</option>
                                </select>
                              </td>
                              <td className="px-5 py-3 align-top">
                                <select
                                  value={priority}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={(event) =>
                                    handleInlinePriorityChange(
                                      todo,
                                      event.target.value as Priority
                                    )
                                  }
                                  aria-label={`设置 ${todo.title} 优先级`}
                                  className="w-full rounded-[14px] border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-sky-700 dark:focus:ring-sky-950"
                                >
                                  <option value="low">低优先级</option>
                                  <option value="medium">中优先级</option>
                                  <option value="high">高优先级</option>
                                </select>
                              </td>
                              <td className="px-5 py-3 align-top text-slate-600 dark:text-slate-300">
                                {todo.category || "未分类"}
                              </td>
                              <td className="px-5 py-3 align-top">
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
                                    dueMeta.tone
                                  )}
                                >
                                  <Calendar size={12} />
                                  {dueMeta.label}
                                </span>
                              </td>
                              <td className="px-5 py-3 align-top">
                                <span
                                  className={cn(
                                    "inline-flex rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
                                    bucketMeta[bucket].badge
                                  )}
                                >
                                  {bucketMeta[bucket].label}
                                </span>
                              </td>
                              <td className="px-5 py-3 align-top text-right">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    deleteTodo.mutate({ id: todo.id });
                                  }}
                                  className="rounded-full p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/30"
                                  title="删除"
                                  aria-label={`删除 ${todo.title}`}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : (
                <div className="grid gap-4 2xl:grid-cols-2">
                  {sectionConfigs.map((section) => (
                    <section
                      key={section.key}
                      className={cn(
                        "rounded-[24px] border p-4 shadow-sm",
                        section.panelTone
                      )}
                    >
                      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div
                            className={cn(
                              "grid size-9 place-items-center rounded-xl",
                              section.iconTone
                            )}
                          >
                            <section.icon size={18} />
                          </div>
                          <div>
                            <h2 className="text-base font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                              {section.title}
                            </h2>
                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                              {section.subtitle}
                            </p>
                          </div>
                        </div>
                        <div
                          className={cn(
                            "rounded-full px-3 py-1 text-xs font-medium",
                            section.countTone
                          )}
                        >
                          {section.items.length} 项
                        </div>
                      </div>

                      {section.items.length === 0 ? (
                        <p className="rounded-[22px] border border-dashed border-slate-200/80 px-4 py-4 text-sm text-slate-400 dark:border-slate-800 dark:text-slate-500">
                          {section.empty}
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {(() => {
                            const previewCount =
                              section.key === "noDate"
                                ? 5
                                : section.key === "completed"
                                  ? 4
                                  : 6;
                            const shouldExpand =
                              expandedSections[section.key] ||
                              section.items.some((item) => item.id === selectedTodoId);
                            const visibleItems = shouldExpand
                              ? section.items
                              : section.items.slice(0, previewCount);

                            return (
                              <>
                                {visibleItems.map((todo) => {
                                  const status = (todo.status ?? "todo") as Status;
                                  const priority = (todo.priority ?? "medium") as Priority;
                                  const dueMeta = formatRelativeDueDate(todo.dueDate);
                                  const CompletionIcon =
                                    status === "done" ? CheckCircle2 : Circle;

                                  return (
                                    <div
                                      key={todo.id}
                                      data-todo-id={todo.id}
                                      onClick={() => {
                                        setSelectedTodoId(todo.id);
                                        setEditorDraft(toEditorDraft(todo));
                                      }}
                                      className={cn(
                                        "group flex cursor-pointer items-start gap-4 rounded-[20px] border bg-white p-4 shadow-sm transition dark:bg-slate-950",
                                        selectedTodoId === todo.id
                                          ? "border-sky-300/80 ring-1 ring-sky-200 dark:border-sky-700 dark:ring-sky-900"
                                          : "border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700"
                                      )}
                                    >
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          toggleDone(todo);
                                        }}
                                        title={status === "done" ? "恢复为待办" : "标记完成"}
                                        className={cn(
                                          "mt-0.5 grid size-10 place-items-center rounded-full border transition",
                                          status === "done"
                                            ? statusMeta.done.buttonTone
                                            : "border-slate-200 bg-white text-slate-400 hover:border-emerald-300 hover:text-emerald-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-500 dark:hover:border-emerald-700 dark:hover:text-emerald-300"
                                        )}
                                      >
                                        <CompletionIcon
                                          size={18}
                                          className={cn(
                                            status === "done" && "text-emerald-500"
                                          )}
                                        />
                                      </button>

                                      <div className="min-w-0 flex-1">
                                        <div className="min-w-0">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <h3
                                              className={cn(
                                                "truncate text-[15px] font-semibold tracking-[-0.03em] text-slate-950 dark:text-white",
                                                status === "done" &&
                                                  "text-slate-400 line-through dark:text-slate-500"
                                              )}
                                            >
                                              {todo.title}
                                            </h3>
                                            {todo.category && (
                                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                                {todo.category}
                                              </span>
                                            )}
                                          </div>
                                          {todo.description && (
                                            <p className="mt-2 line-clamp-1 text-sm text-slate-500 dark:text-slate-400">
                                              {todo.description}
                                            </p>
                                          )}
                                        </div>

                                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                                          {status !== "done" ? (
                                            <button
                                              type="button"
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                toggleInProgress(todo);
                                              }}
                                              className={cn(
                                                "rounded-full px-2.5 py-1 font-medium transition",
                                                statusMeta[status].badge
                                              )}
                                            >
                                              {statusMeta[status].label}
                                            </button>
                                          ) : (
                                            <span
                                              className={cn(
                                                "rounded-full px-2.5 py-1 font-medium",
                                                statusMeta[status].badge
                                              )}
                                            >
                                              {statusMeta[status].label}
                                            </span>
                                          )}
                                          <span
                                            className={cn(
                                              "rounded-full px-2.5 py-1 font-medium",
                                              priorityMeta[priority].badge
                                            )}
                                          >
                                            {priorityMeta[priority].label}
                                          </span>
                                          {todo.dueDate && (
                                            <span
                                              className={cn(
                                                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium",
                                                dueMeta.tone
                                              )}
                                            >
                                              <Calendar size={12} />
                                              {dueMeta.label}
                                            </span>
                                          )}
                                        </div>
                                      </div>

                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          deleteTodo.mutate({ id: todo.id });
                                        }}
                                        className="rounded-full p-2 text-slate-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 dark:hover:bg-rose-950/30"
                                        title="删除"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    </div>
                                  );
                                })}

                                {section.items.length > previewCount && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedSections((current) => ({
                                        ...current,
                                        [section.key]: !shouldExpand,
                                      }))
                                    }
                                    className="w-full rounded-[20px] border border-dashed border-slate-200/80 px-4 py-3 text-sm font-medium text-slate-500 transition hover:border-slate-300 hover:bg-white/60 dark:border-slate-800 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:bg-slate-950/40"
                                  >
                                    {shouldExpand
                                      ? `收起 ${section.title}`
                                      : `展开剩余 ${section.items.length - previewCount} 项`}
                                  </button>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </section>
                  ))}
                </div>
              )
            )}
          </div>
        </div>

        {selectedTodo && editorDraft && (
          <aside className="xl:sticky xl:top-6 xl:self-start">
            <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <div>
                <div className="border-b border-slate-200 px-5 py-5 dark:border-slate-800">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-950 dark:text-white">
                        任务详情
                      </div>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        表格里先快改属性，补充上下文和时间安排再来这里。
                      </p>
                      <h2 className="mt-4 text-xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                        {selectedTodo.title}
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTodoId(null);
                        setEditorDraft(null);
                      }}
                      className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                      title="关闭"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium",
                        statusMeta[editorDraft.status].badge
                      )}
                    >
                      {statusMeta[editorDraft.status].label}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium",
                        priorityMeta[editorDraft.priority].detailTone
                      )}
                    >
                      {priorityMeta[editorDraft.priority].label}
                    </span>
                    {selectedTodo.category && (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                        {selectedTodo.category}
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-4 p-5">
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={editorDraft.title}
                      onChange={(event) =>
                        setEditorDraft((current) =>
                          current
                            ? { ...current, title: event.target.value }
                            : current
                        )
                      }
                      aria-label="编辑任务标题"
                      className="w-full rounded-[22px] border border-slate-200 bg-slate-50/85 px-4 py-3 text-sm font-medium text-slate-950 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-sky-700 dark:focus:ring-sky-950"
                    />
                    <textarea
                      value={editorDraft.description}
                      onChange={(event) =>
                        setEditorDraft((current) =>
                          current
                            ? { ...current, description: event.target.value }
                            : current
                        )
                      }
                      rows={4}
                      placeholder="补充更完整的上下文"
                      aria-label="编辑任务描述"
                      className="w-full rounded-[22px] border border-slate-200 bg-slate-50/85 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-sky-700 dark:focus:ring-sky-950"
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <select
                        value={editorDraft.status}
                        onChange={(event) =>
                          setEditorDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  status: event.target.value as Status,
                                }
                              : current
                          )
                        }
                        aria-label="编辑任务状态"
                        className="rounded-[22px] border border-slate-200 bg-slate-50/85 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-sky-700 dark:focus:ring-sky-950"
                      >
                        <option value="todo">待办</option>
                        <option value="in_progress">进行中</option>
                        <option value="done">已完成</option>
                      </select>
                      <select
                        value={editorDraft.priority}
                        onChange={(event) =>
                          setEditorDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  priority: event.target.value as Priority,
                                }
                              : current
                          )
                        }
                        aria-label="编辑任务优先级"
                        className="rounded-[22px] border border-slate-200 bg-slate-50/85 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-sky-700 dark:focus:ring-sky-950"
                      >
                        <option value="low">低优先级</option>
                        <option value="medium">中优先级</option>
                        <option value="high">高优先级</option>
                      </select>
                    </div>
                    <select
                      value={editorDraft.category}
                      onChange={(event) =>
                        setEditorDraft((current) =>
                          current
                            ? { ...current, category: event.target.value }
                            : current
                        )
                      }
                      aria-label="编辑任务分类"
                      className="w-full rounded-[22px] border border-slate-200 bg-slate-50/85 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-sky-700 dark:focus:ring-sky-950"
                    >
                      <option value="">未分类</option>
                      {categories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {[
                          { label: "今天", offset: 0, time: "18:00" },
                          { label: "明天", offset: 1, time: "09:00" },
                          { label: "下周", offset: 7, time: "09:00" },
                        ].map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() =>
                              setEditorDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      dueDate: getQuickDueValue(
                                        preset.offset,
                                        preset.time
                                      ),
                                    }
                                  : current
                              )
                            }
                            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                          >
                            {preset.label}
                          </button>
                        ))}
                        {editorDraft.dueDate && (
                          <button
                            type="button"
                            onClick={() =>
                              setEditorDraft((current) =>
                                current ? { ...current, dueDate: "" } : current
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            <X size={14} />
                            清空时间
                          </button>
                        )}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
                        <label className="flex items-center gap-2 rounded-[22px] border border-slate-200 bg-slate-50/85 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                          <Calendar size={16} className="text-slate-400" />
                          <input
                            type="date"
                            value={getDatePart(editorDraft.dueDate)}
                            onChange={(event) =>
                              setEditorDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      dueDate: joinDateAndTime(
                                        event.target.value,
                                        getTimePart(current.dueDate) || "09:00"
                                      ),
                                    }
                                  : current
                              )
                            }
                            aria-label="编辑任务截止时间"
                            className="w-full bg-transparent text-slate-900 outline-none dark:text-white"
                          />
                        </label>
                        <select
                          value={getTimePart(editorDraft.dueDate) || "09:00"}
                          onChange={(event) =>
                            setEditorDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    dueDate: current.dueDate
                                      ? joinDateAndTime(
                                          getDatePart(current.dueDate),
                                          event.target.value
                                        )
                                      : current.dueDate,
                                  }
                                : current
                            )
                          }
                          aria-label="编辑任务截止时刻"
                          disabled={!editorDraft.dueDate}
                          className="rounded-[22px] border border-slate-200 bg-slate-50/85 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-sky-700 dark:focus:ring-sky-950"
                        >
                          {TIME_OPTIONS.map((time) => (
                            <option key={time} value={time}>
                              {time}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[24px] bg-slate-50 px-4 py-4 text-xs leading-6 text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                    <div>
                      创建于{" "}
                      {selectedTodo.createdAt
                        ? formatAbsoluteDate(selectedTodo.createdAt)
                        : "未知"}
                    </div>
                    <div className="mt-1">
                      最近更新{" "}
                      {selectedTodo.updatedAt
                        ? formatAbsoluteDate(selectedTodo.updatedAt)
                        : "未知"}
                    </div>
                    {selectedTodo.dueDate && (
                      <div className="mt-1">
                        当前安排 {formatAbsoluteDate(selectedTodo.dueDate)}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleSaveSelectedTodo}
                      disabled={!editorDraft.title.trim() || updateTodo.isPending}
                      className="rounded-[22px] bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                    >
                      保存修改
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteTodo.mutate({ id: selectedTodo.id })}
                      className="rounded-[22px] border border-rose-200 px-4 py-3 text-sm font-medium text-rose-600 transition hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/30"
                    >
                      删除任务
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
