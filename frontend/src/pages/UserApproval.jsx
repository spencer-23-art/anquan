import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import api from "../lib/axios";

export default function UserApproval() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = async () => {
    try {
      const res = await api.get("/users");
      setUsers(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleAction = async (id, action) => {
    try {
      await api.put(`/users/${id}/${action}`);
      fetchUsers();
    } catch (err) {
      alert(`操作失败：${err.response?.data?.detail || err.message}`);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("确认删除这个用户吗？此操作不可恢复。")) {
      return;
    }

    try {
      await api.delete(`/users/${id}`);
      fetchUsers();
    } catch (err) {
      alert(`删除失败：${err.response?.data?.detail || err.message}`);
    }
  };

  if (loading) {
    return <div className="text-foreground">加载中...</div>;
  }

  return (
    <div className="space-y-6 text-foreground">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">用户审核</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          审核、通过、驳回或删除已注册的巡检账号。
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-secondary/50 font-medium text-muted-foreground">
            <tr>
              <th className="px-6 py-3">编号</th>
              <th className="px-6 py-3">用户名</th>
              <th className="px-6 py-3">手机号</th>
              <th className="px-6 py-3">角色</th>
              <th className="px-6 py-3">状态</th>
              <th className="px-6 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((user) => (
              <tr key={user.id} className="transition-colors hover:bg-secondary/20">
                <td className="px-6 py-4">{user.id}</td>
                <td className="px-6 py-4 font-semibold">{user.username}</td>
                <td className="px-6 py-4">{user.phone || "-"}</td>
                <td className="px-6 py-4">
                  {user.role === "admin" ? "管理员" : "巡检员"}
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${
                      user.status === "approved"
                        ? "bg-green-500/10 text-green-500"
                        : user.status === "rejected"
                          ? "bg-destructive/10 text-destructive"
                          : "bg-yellow-500/10 text-yellow-500"
                    }`}
                  >
                    {user.status === "approved"
                      ? "已通过"
                      : user.status === "rejected"
                        ? "已驳回"
                        : "待审核"}
                  </span>
                </td>
                <td className="flex items-center justify-end gap-1 px-6 py-4 text-right">
                  {user.status === "pending" ? (
                    <>
                      <button
                        onClick={() => handleAction(user.id, "approve")}
                        className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
                      >
                        通过
                      </button>
                      <button
                        onClick={() => handleAction(user.id, "reject")}
                        className="rounded border border-border px-3 py-1 text-xs text-foreground hover:bg-secondary"
                      >
                        驳回
                      </button>
                    </>
                  ) : null}
                  <button
                    onClick={() => handleDelete(user.id)}
                    className="rounded p-1.5 text-destructive transition-colors hover:bg-destructive/10 hover:text-destructive/80"
                    title="删除用户"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                  暂无用户数据。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
