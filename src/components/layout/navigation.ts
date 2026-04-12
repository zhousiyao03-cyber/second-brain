import {
  Activity,
  FileText,
  FolderGit2,
  LayoutDashboard,
  MessageCircle,
  Timer,
  TrendingUp,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const navigationGroups: NavGroup[] = [
  {
    label: "CAPTURE",
    items: [
      { href: "/dashboard", label: "Home", icon: LayoutDashboard },
      { href: "/notes", label: "Notes", icon: FileText },
      { href: "/ask", label: "Ask AI", icon: MessageCircle },
    ],
  },
  {
    label: "LEARN",
    items: [
      { href: "/projects", label: "Projects", icon: FolderGit2 },
    ],
  },
  {
    label: "TRACK",
    items: [
      { href: "/portfolio", label: "Portfolio", icon: TrendingUp },
      { href: "/focus", label: "Focus", icon: Timer },
    ],
  },
  {
    label: "INSIGHTS",
    items: [
      { href: "/usage", label: "Usage", icon: Activity },
    ],
  },
];

/** Flat list for backwards compat (mobile nav uses this) */
export const navigationItems = navigationGroups.flatMap((g) => g.items);
