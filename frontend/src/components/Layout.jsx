import React, { useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bot,
  FileCheck,
  FileText,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useAuthStore } from "../stores/auth";

const links = [
  { to: "/dashboard", icon: LayoutDashboard, label: "系统概览" },
  { to: "/ai-chat", icon: Bot, label: "AI 风险分析" },
  { to: "/permits", icon: FileCheck, label: "作业许可" },
  { to: "/areas", icon: MapIcon, label: "区域管理" },
  { to: "/approvals", icon: Users, label: "用户审核" },
  { to: "/fines", icon: FileText, label: "在线罚单" },
  { to: "/settings", icon: Settings, label: "系统设置" },
];

function SidebarContent({ user, onLogout, onNavigate }) {
  return (
    <>
      <div className="border-b border-border p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-8 w-8 text-primary" />
          <div>
            <div className="text-lg font-bold tracking-tight text-slate-900">安全巡检</div>
            <div className="text-xs text-muted-foreground">SafeInspect</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-2 p-4">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl p-3 transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`
            }
          >
            <link.icon size={20} />
            <span className="font-medium">{link.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border p-4">
        <div className="mb-4 flex items-center gap-3 px-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
            {user?.username?.[0]?.toUpperCase() || "A"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user?.username || "管理员"}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.role || "admin"}</p>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-3 rounded-xl p-3 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOut size={20} />
          <span className="font-medium">退出登录</span>
        </button>
      </div>
    </>
  );
}

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  const currentTitle = useMemo(
    () => links.find((item) => item.to === location.pathname)?.label || "安全巡检管理系统",
    [location.pathname]
  );

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 border-r border-border bg-card lg:flex lg:flex-col">
        <SidebarContent user={user} onLogout={handleLogout} />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/35"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 z-50 flex w-[86vw] max-w-[320px] flex-col border-r border-border bg-white shadow-2xl">
            <div className="flex items-center justify-end p-3">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-xl border border-slate-200 p-2 text-slate-600"
              >
                <X size={18} />
              </button>
            </div>
            <SidebarContent
              user={user}
              onLogout={handleLogout}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      <main className="flex min-w-0 flex-1 flex-col bg-muted/30">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-white/92 px-4 py-3 backdrop-blur lg:hidden">
          <div className="min-w-0">
            <div className="text-xs text-slate-500">安全巡检管理系统</div>
            <div className="truncate text-sm font-semibold text-slate-900">{currentTitle}</div>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-xl border border-slate-200 p-2 text-slate-700"
          >
            <Menu size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-auto">
          <div className="p-3 sm:p-4 lg:p-8">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
