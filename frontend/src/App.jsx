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

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
};

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
        <ProtectedRoute>
          <Layout />
        </ProtectedRoute>
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
