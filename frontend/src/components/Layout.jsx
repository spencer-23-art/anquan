import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  FileCheck, 
  FileText,
  Map as MapIcon, 
  Settings, 
  LogOut, 
  ShieldCheck,
  Users,
  Bot
} from 'lucide-react';
import { useAuthStore } from '../stores/auth';

const Layout = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const links = [
    { to: '/dashboard', icon: LayoutDashboard, label: '系统概览' },
    { to: '/ai-chat', icon: Bot, label: 'AI 风险分析' },
    { to: '/permits', icon: FileCheck, label: '作业许可' },
    { to: '/areas', icon: MapIcon, label: '区域管理' },
    { to: '/approvals', icon: Users, label: '用户审核' },
    { to: '/fines', icon: FileText, label: '在线罚单' },
    { to: '/settings', icon: Settings, label: '系统设置' },
  ];

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-card flex flex-col">
        <div className="p-6 border-b border-border flex items-center gap-3">
          <ShieldCheck className="text-primary w-8 h-8" />
          <span className="text-xl font-bold tracking-tight">SafeInspect</span>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => 
                `flex items-center gap-3 p-3 rounded-lg transition-colors ${
                  isActive 
                    ? 'bg-primary text-primary-foreground' 
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`
              }
            >
              <link.icon size={20} />
              <span className="font-medium">{link.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3 mb-4 px-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
              {user?.username?.[0]?.toUpperCase() || 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.username || '管理员'}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.role || 'ADMIN'}</p>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 w-full p-3 text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded-lg transition-colors"
          >
            <LogOut size={20} />
            <span className="font-medium">退出登录</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-muted/30">
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;
