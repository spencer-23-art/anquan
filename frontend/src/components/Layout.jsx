import React, { useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bot,
  CalendarDays,
  ClipboardCheck,
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
  { to: "/dashboard", icon: LayoutDashboard, label: "任务执行", roles: ["admin", "inspector", "external"] },
  { to: "/ai-chat", icon: Bot, label: "安全风险", roles: ["admin"] },
  { to: "/quality-control", icon: ClipboardCheck, label: "质量控制", roles: ["admin"] },
  { to: "/permits", icon: FileCheck, label: "作业许可", roles: ["admin", "inspector", "external"] },
  { to: "/fines", icon: FileText, label: "在线罚单", roles: ["admin", "inspector", "external"] },
  { to: "/safety-logs", icon: CalendarDays, label: "安全日志", roles: ["admin", "inspector", "external"] },
  { to: "/areas", icon: MapIcon, label: "区域管理", roles: ["admin"] },
  { to: "/approvals", icon: Users, label: "用户审核", roles: ["admin"] },
  { to: "/settings", icon: Settings, label: "系统设置", roles: ["admin"] },
];

const roleLabels = {
  admin: "管理员",
  inspector: "安全员",
  external: "其他单位",
};

const normalizeRole = (role) => String(role || "").toLowerCase();

function SidebarContent({ user, onLogout, onNavigate }) {
  const userRole = normalizeRole(user?.role || "admin");
  const visibleLinks = links.filter((link) => link.roles.includes(userRole));

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
        {visibleLinks.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl p-3 transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-slate-900 dark:text-muted-foreground hover:bg-accent hover:text-accent-foreground"
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
            <p className="truncate text-xs text-muted-foreground">{roleLabels[userRole] || userRole || "管理员"}</p>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-3 rounded-xl p-3 text-slate-900 dark:text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
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
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);

  const currentTitle = useMemo(
    () => links.find((item) => item.to === location.pathname)?.label || "安全巡检管理系统",
    [location.pathname]
  );

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const handleTouchStart = (event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
  };

  const handleTouchEnd = (event) => {
    const touch = event.changedTouches?.[0];
    if (!touch || touchStartX.current == null || touchStartY.current == null) return;
    const dx = touch.clientX - touchStartX.current;
    const dy = touch.clientY - touchStartY.current;
    const horizontalSwipe = Math.abs(dx) > Math.abs(dy) * 1.4;
    const startedNearLeft = touchStartX.current <= 34;

    if (horizontalSwipe && !mobileOpen && startedNearLeft && dx > 55) setMobileOpen(true);
    if (horizontalSwipe && mobileOpen && dx < -55) setMobileOpen(false);

    touchStartX.current = null;
    touchStartY.current = null;
  };

  return (
    <div
      className="flex min-h-screen text-slate-900 dark:text-slate-100"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <aside className="hidden w-56 border-r border-white/20 dark:border-white/10 glass-panel xl:w-60 lg:flex lg:flex-col">
        <SidebarContent user={user} onLogout={handleLogout} />
      </aside>

      <div
        className={`fixed inset-0 z-40 transition lg:hidden ${
          mobileOpen ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
          <button
            type="button"
            className={`absolute inset-0 bg-slate-950/35 transition-opacity duration-200 ease-out ${
              mobileOpen ? "opacity-100" : "opacity-0"
            }`}
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className={`absolute inset-y-0 left-0 z-50 flex w-[86vw] max-w-[320px] transform flex-col border-r border-white/20 dark:border-white/10 glass-panel transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
              mobileOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
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

      <main className="flex min-w-0 flex-1 flex-col bg-transparent">
        <header className="sticky top-0 z-30 flex items-center justify-start gap-3 glass-header px-4 py-3 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="shrink-0 rounded-xl border border-slate-200 p-2 text-slate-700"
          >
            <Menu size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-slate-500">安全巡检管理系统</div>
            <div className="truncate text-sm font-semibold text-slate-900">{currentTitle}</div>
          </div>
        </header>

        <div className="flex-1 overflow-auto">
          <div className="p-3 sm:p-4 lg:p-5 xl:p-6">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
