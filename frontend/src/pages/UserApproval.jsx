import { useEffect, useMemo, useState } from "react";
import { Save, Trash2, UserCheck } from "lucide-react";
import api from "../lib/axios";

function buildAreaOptions(areas) {
  const childrenByParent = areas.reduce((acc, area) => {
    const key = area.parent_id || "root";
    acc[key] = [...(acc[key] || []), area];
    return acc;
  }, {});
  const result = [];
  const walk = (parentKey, depth) => {
    (childrenByParent[parentKey] || [])
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
      .forEach((area) => {
        result.push({ ...area, depth });
        walk(area.id, depth + 1);
      });
  };
  walk("root", 0);
  return result;
}

function statusText(status) {
  if (status === "approved") return "已通过";
  if (status === "rejected") return "已驳回";
  return "待审核";
}

function normalizedRole(role) {
  return String(role || "").toLowerCase();
}

export default function UserApproval() {
  const [users, setUsers] = useState([]);
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const areaOptions = useMemo(() => buildAreaOptions(areas), [areas]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [userRes, areaRes] = await Promise.all([api.get("/users"), api.get("/areas")]);
      setUsers(userRes.data || []);
      setAreas(areaRes.data || []);
    } catch (error) {
      setMessage(error?.response?.data?.detail || "用户数据加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const updateUserLocal = (userId, patch) => {
    setUsers((current) => current.map((user) => (user.id === userId ? { ...user, ...patch } : user)));
  };

  const savePermissions = async (user) => {
    try {
      await api.put(`/users/${user.id}/permissions`, {
        role: normalizedRole(user.role),
        managed_area_id: (normalizedRole(user.role) === "admin" || normalizedRole(user.role) === "external") && user.managed_area_id ? Number(user.managed_area_id) : null,
        status: user.status,
      });
      setMessage(`${user.username} 的权限已保存。`);
      await loadData();
    } catch (error) {
      setMessage(error?.response?.data?.detail || "权限保存失败");
    }
  };

  const handleDelete = async (userId) => {
    if (!window.confirm("确认删除这个用户吗？此操作不可恢复。")) return;
    try {
      await api.delete(`/users/${userId}`);
      setMessage("用户已删除。");
      await loadData();
    } catch (error) {
      setMessage(error?.response?.data?.detail || "删除失败");
    }
  };

  if (loading) {
    return <div className="text-foreground">加载中...</div>;
  }

  return (
    <div className="space-y-6 text-foreground">
      <div>
        <div className="flex items-center gap-2">
          <UserCheck className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">用户审核与权限</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">安全员账号用于风险排查客户端；管理员账号可进入后台，并按分配区域管理项目。</p>
      </div>

      {message ? <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">{message}</div> : null}

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-border bg-secondary/50 font-medium text-muted-foreground">
            <tr>
              <th className="px-4 py-3">用户</th>
              <th className="px-4 py-3">手机号</th>
              <th className="px-4 py-3">角色</th>
              <th className="px-4 py-3">管理区域</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((user) => (
              <tr key={user.id} className="transition-colors hover:bg-secondary/20">
                <td className="px-4 py-4">
                  <div className="font-semibold">{user.username}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{user.real_name}</div>
                </td>
                <td className="px-4 py-4">{user.phone || "-"}</td>
                <td className="px-4 py-4">
                    <select className="w-full rounded-lg border border-border bg-card px-3 py-2" value={normalizedRole(user.role)} onChange={(event) => updateUserLocal(user.id, { role: event.target.value })}>
                      <option value="inspector">安全员</option>
                      <option value="external">其他单位</option>
                      <option value="admin">管理员</option>
                    </select>
                </td>
                <td className="px-4 py-4">
                  <select className="w-full rounded-lg border border-border bg-card px-3 py-2" value={user.managed_area_id || ""} disabled={normalizedRole(user.role) !== "admin" && normalizedRole(user.role) !== "external"} onChange={(event) => updateUserLocal(user.id, { managed_area_id: event.target.value || null })}>
                    <option value="">不分配区域</option>
                    {areaOptions.map((area) => <option key={area.id} value={area.id}>{`${"　".repeat(area.depth)}${area.name}`}</option>)}
                  </select>
                </td>
                <td className="px-4 py-4">
                  <select className="w-full rounded-lg border border-border bg-card px-3 py-2" value={user.status} onChange={(event) => updateUserLocal(user.id, { status: event.target.value })}>
                    <option value="pending">待审核</option>
                    <option value="approved">通过</option>
                    <option value="rejected">驳回</option>
                  </select>
                  <div className="mt-2 text-xs text-muted-foreground">{statusText(user.status)}</div>
                </td>
                <td className="px-4 py-4">
                  <div className="flex items-center justify-end gap-2">
                    <button type="button" onClick={() => savePermissions(user)} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                      <Save className="h-3.5 w-3.5" />
                      保存
                    </button>
                    <button type="button" onClick={() => handleDelete(user.id)} className="rounded-lg p-2 text-destructive hover:bg-destructive/10" title="删除用户">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">暂无用户数据。</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
