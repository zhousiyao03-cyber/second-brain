import {
  Activity,
  FileText,
  GraduationCap,
  LayoutDashboard,
  MessageCircle,
  FolderGit2,
  Timer,
  TrendingUp,
} from "lucide-react";

export const navigationItems = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/notes", label: "Notes", icon: FileText },
  { href: "/learn", label: "Learn", icon: GraduationCap },
  { href: "/projects", label: "Projects", icon: FolderGit2 },
  { href: "/focus", label: "Focus", icon: Timer },
  { href: "/portfolio", label: "Portfolio", icon: TrendingUp },
  ...(process.env.NEXT_PUBLIC_ENABLE_TOKEN_USAGE === "true"
    ? [{ href: "/usage", label: "Token Usage", icon: Activity }]
    : []),
  { href: "/ask", label: "Ask AI", icon: MessageCircle },
] as const;
