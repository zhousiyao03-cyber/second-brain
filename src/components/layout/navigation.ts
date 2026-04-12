import {
  Activity,
  BookOpen,
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
  /** If set, this item is only shown when the corresponding feature flag is true */
  featureFlag?: "tokenUsage" | "portfolio" | "ossProjects" | "focusTracker";
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const navigationGroups: NavGroup[] = [
  {
    label: "CAPTURE",
    items: [
      { href: "/", label: "Home", icon: LayoutDashboard },
      { href: "/notes", label: "Notes", icon: FileText },
      { href: "/ask", label: "Ask AI", icon: MessageCircle },
    ],
  },
  {
    label: "LEARN",
    items: [
      { href: "/learn", label: "Learning", icon: BookOpen },
      { href: "/projects", label: "Projects", icon: FolderGit2, featureFlag: "ossProjects" },
    ],
  },
  {
    label: "TRACK",
    items: [
      { href: "/portfolio", label: "Portfolio", icon: TrendingUp, featureFlag: "portfolio" },
      { href: "/focus", label: "Focus", icon: Timer, featureFlag: "focusTracker" },
    ],
  },
  {
    label: "INSIGHTS",
    items: [
      { href: "/usage", label: "Usage", icon: Activity, featureFlag: "tokenUsage" },
    ],
  },
];

/** Flat list for backwards compat (mobile nav uses this) */
export const navigationItems = navigationGroups.flatMap((g) => g.items);
