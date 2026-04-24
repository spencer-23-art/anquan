import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/Register';
import Layout from './components/Layout';
import TaskDashboard from './pages/TaskDashboard';
import AIChatTask from './pages/AIChatTask';
import PermitMonitor from './pages/PermitMonitor';
import FineTicketCenter from './pages/FineTicketCenter';
import AreaManagement from './pages/AreaManagement';
import UserApproval from './pages/UserApproval';
import SystemSettings from './pages/SystemSettings';
import { useAuthStore } from './stores/auth';

const AdminRoute = ({ children }) => {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role !== "admin") return <InspectorWaiting />;
  return children;
};

function InspectorWaiting() {
  const { logout } = useAuthStore();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold">安全员客户端暂未开放</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          当前账号用于后续风险排查客户端，后台管理系统仅管理员可进入。
        </p>
        <button
          type="button"
          onClick={logout}
          className="mt-5 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground"
        >
          返回登录
        </button>
      </div>
    </div>
  );
}

function App() {
  const { isAuthenticated } = useAuthStore();

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Login />}
      />
      <Route
        path="/register"
        element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Register />}
      />
      <Route path="/" element={
        <AdminRoute>
          <Layout />
        </AdminRoute>
      }>
        <Route index element={<TaskDashboard />} />
        <Route path="dashboard" element={<TaskDashboard />} />
        <Route path="ai-chat" element={<AIChatTask />} />
        <Route path="permits" element={<PermitMonitor />} />
        <Route path="fines" element={<FineTicketCenter />} />
        <Route path="areas" element={<AreaManagement />} />
        <Route path="approvals" element={<UserApproval />} />
        <Route path="settings" element={<SystemSettings />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
      <Route
        path="*"
        element={<Navigate to={isAuthenticated ? "/dashboard" : "/login"} replace />}
      />
    </Routes>
  );
}

export default App;
