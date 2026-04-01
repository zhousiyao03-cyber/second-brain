import {
  Activity,
  FileText,
  LayoutDashboard,
  MessageCircle,
  Timer,
  TrendingUp,
} from "lucide-react";

export const navigationItems = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/notes", label: "Notes", icon: FileText },
  { href: "/focus", label: "Focus", icon: Timer },
  { href: "/portfolio", label: "Portfolio", icon: TrendingUp },
  ...(process.env.NEXT_PUBLIC_ENABLE_TOKEN_USAGE === "true"
    ? [{ href: "/usage", label: "Token Usage", icon: Activity }]
    : []),
  { href: "/ask", label: "Ask AI", icon: MessageCircle },
] as const;
