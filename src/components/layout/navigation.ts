import {
  Activity,
  Bookmark,
  CheckSquare,
  Compass,
  FileText,
  LayoutDashboard,
  MessageCircle,
} from "lucide-react";

export const navigationItems = [
  { href: "/", label: "首页", icon: LayoutDashboard },
  { href: "/notes", label: "笔记", icon: FileText },
  { href: "/bookmarks", label: "收藏", icon: Bookmark },
  ...(process.env.NEXT_PUBLIC_ENABLE_TOKEN_USAGE === "true"
    ? [{ href: "/usage", label: "Token 用量", icon: Activity }]
    : []),
  { href: "/todos", label: "Todo", icon: CheckSquare },
  { href: "/explore", label: "AI 探索", icon: Compass },
  { href: "/ask", label: "Ask AI", icon: MessageCircle },
] as const;
