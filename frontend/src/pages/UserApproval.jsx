import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Ban,
  Check,
  Clock3,
  Loader2,
  Save,
  ShieldCheck,
  UserCheck,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import api from "../lib/axios";
import { useAuthStore } from "../stores/auth";

const statusMeta = {
  pending: { label: "待审核", className: "bg-amber-50 text-amber-800" },
  approved: { label: "在用", className: "bg-emerald-50 text-emerald-800" },
  rejected: { label: "已驳回", className: "bg-rose-50 text-rose-800" },
  suspended: { label: "已停用", className: "bg-slate-100 text-slate-700" },
};

function buildAreaOptions(areas) {
  const byParent = areas.reduce((index, area) => {
    const key = area.parent_id || "root";
    index[key] = [...(index[key] || []), area];
    return index;
  }, {});
  const options = [];
  const walk = (parentId, depth) => {
    (byParent[parentId] || [])
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
      .forEach((area) => {
        options.push({ ...area, depth });
        walk(area.id, depth + 1);
      });
  };
  walk("root", 0);
  return options;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("zh-CN");
}

export default function UserApproval() {
  const currentUser = useAuthStore((state) => state.user);
  const [users, setUsers] = useState([]);
  const [areas, setAreas] = useState([]);
  const [tab, setTab] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("success");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [userResponse, areaResponse] = await Promise.all([
        api.get("/users"),
        api.get("/areas", { params: { include_all: true } }),
      ]);
      setUsers(userResponse.data || []);
      setAreas((areaResponse.data || []).filter((area) => area.is_active !== false));
    } catch (error) {
      setMessage(error?.response?.data?.detail || "用户目录加载失败。");
      setMessageTone("error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const areaOptions = useMemo(() => buildAreaOptions(areas), [areas]);
  const counts = useMemo(() => ({
    pending: users.filter((user) => user.status === "pending").length,
    active: users.filter((user) => user.status === "approved").length,
    inactive: users.filter((user) => user.status === "rejected" || user.status === "suspended").length,
  }), [users]);
  const displayedUsers = useMemo(() => users.filter((user) => {
    if (tab === "pending") return user.status === "pending";
    if (tab === "active") return user.status === "approved";
    return user.status === "rejected" || user.status === "suspended";
  }), [tab, users]);

  const notify = (text, tone = "success") => {
    setMessage(text);
    setMessageTone(tone);
  };

  const patchUser = (userId, patch) => {
    setUsers((current) => current.map((user) => (user.id === userId ? { ...user, ...patch } : user)));
  };

  const saveAccess = async (user, nextStatus = user.status, successMessage = "账号授权已保存。") => {
    const role = String(user.role || "inspector").toLowerCase();
    const requiresArea = role === "admin" || role === "external";
    if (requiresArea && !user.managed_area_id) {
      notify("区域管理员和外部协作方必须分配管理区域。", "error");
      return;
    }
    setBusyUserId(user.id);
    try {
      await api.put(`/users/${user.id}/permissions`, {
        role,
        managed_area_id: requiresArea ? Number(user.managed_area_id) : null,
        status: nextStatus,
      });
      notify(successMessage);
      await loadData();
    } catch (error) {
      notify(error?.response?.data?.detail || "账号授权保存失败。", "error");
    } finally {
      setBusyUserId(null);
    }
  };

  const rejectUser = async (user) => {
    if (!window.confirm(`确认驳回 ${user.real_name || user.username} 的申请吗？`)) return;
    setBusyUserId(user.id);
    try {
      await api.post(`/users/${user.id}/reject`);
      notify("申请已驳回，账号不会获得系统访问权限。");
      await loadData();
    } catch (error) {
      notify(error?.response?.data?.detail || "驳回失败。", "error");
    } finally {
      setBusyUserId(null);
    }
  };

  if (loading) {
    return <div className="flex min-h-56 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在加载用户目录</div>;
  }

  return (
    <div className="space-y-5 text-foreground">
      <header className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2"><UsersRound className="h-6 w-6 text-primary" /><h1 className="text-2xl font-semibold">用户与授权管理</h1></div>
          <p className="mt-1 text-sm text-muted-foreground">先审核身份，再分配角色和区域范围。离岗账号停用并保留操作记录，不直接删除。</p>
        </div>
        <div className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border bg-card text-center">
          <div className="px-4 py-2"><div className="text-lg font-semibold">{counts.pending}</div><div className="text-xs text-muted-foreground">待审核</div></div>
          <div className="px-4 py-2"><div className="text-lg font-semibold">{counts.active}</div><div className="text-xs text-muted-foreground">在用账号</div></div>
          <div className="px-4 py-2"><div className="text-lg font-semibold">{counts.inactive}</div><div className="text-xs text-muted-foreground">已停用/驳回</div></div>
        </div>
      </header>

      {message ? <div className={`rounded-lg border px-4 py-3 text-sm ${messageTone === "error" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{message}</div> : null}

      <div className="flex flex-wrap gap-2 border-b border-border">
        {[{ id: "pending", label: "待审核", count: counts.pending, icon: Clock3 }, { id: "active", label: "在用账号", count: counts.active, icon: BadgeCheck }, { id: "inactive", label: "已停用", count: counts.inactive, icon: Ban }].map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`inline-flex items-center gap-2 border-b-2 px-3 py-3 text-sm ${active ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}><Icon className="h-4 w-4" />{item.label}<span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{item.count}</span></button>;
        })}
      </div>

      <section className="border border-border bg-card">
        <div className="grid gap-px bg-border md:grid-cols-2 xl:grid-cols-3">
          {displayedUsers.map((user) => {
            const status = statusMeta[user.status] || statusMeta.pending;
            const role = String(user.role || "inspector").toLowerCase();
            const requiresArea = role === "admin" || role === "external";
            const isCurrentUser = user.id === currentUser?.id;
            const isBusy = busyUserId === user.id;
            return (
              <article key={user.id} className="bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{(user.real_name || user.username || "U").slice(0, 1).toUpperCase()}</div>
                    <div className="min-w-0"><div className="truncate font-semibold">{user.real_name || user.username}</div><div className="truncate text-xs text-muted-foreground">{user.username}{user.phone ? ` · ${user.phone}` : ""}</div></div>
                  </div>
                  <span className={`shrink-0 rounded px-2 py-1 text-xs ${status.className}`}>{status.label}</span>
                </div>

                <div className="mt-4 grid gap-3">
                  <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">角色
                    <select value={role} disabled={isCurrentUser || isBusy} onChange={(event) => patchUser(user.id, { role: event.target.value, managed_area_id: event.target.value === "inspector" ? null : user.managed_area_id })} className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm text-foreground disabled:opacity-60">
                      <option value="inspector">安全员</option><option value="external">外部协作方</option><option value="admin">区域管理员</option>
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">管理范围
                    <select value={user.managed_area_id || ""} disabled={isCurrentUser || isBusy || !requiresArea} onChange={(event) => patchUser(user.id, { managed_area_id: event.target.value || null })} className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm text-foreground disabled:opacity-60">
                      <option value="">{requiresArea ? "请选择项目或作业区" : "安全员按任务授权"}</option>
                      {areaOptions.map((area) => <option key={area.id} value={area.id}>{`${"　".repeat(area.depth)}${area.name}`}</option>)}
                    </select>
                  </label>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground"><span>申请时间：{formatDate(user.created_at)}</span>{isCurrentUser ? <span>当前账号不可自改</span> : null}</div>
                {!isCurrentUser ? <div className="mt-3 flex flex-wrap gap-2">
                  {user.status === "pending" ? <><button type="button" disabled={isBusy} onClick={() => saveAccess(user, "approved", "申请已通过并完成授权。 ")} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"><Check className="h-4 w-4" />通过并授权</button><button type="button" disabled={isBusy} onClick={() => rejectUser(user)} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-rose-200 px-3 py-2.5 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"><X className="h-4 w-4" />驳回</button></> : null}
                  {user.status === "approved" ? <><button type="button" disabled={isBusy} onClick={() => saveAccess(user)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2.5 text-sm font-medium hover:bg-muted disabled:opacity-60"><Save className="h-4 w-4" />保存授权</button><button type="button" disabled={isBusy} onClick={() => saveAccess(user, "suspended", "账号已停用，历史业务记录已保留。 ")} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-amber-200 px-3 py-2.5 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-60"><Ban className="h-4 w-4" />停用</button></> : null}
                  {(user.status === "rejected" || user.status === "suspended") ? <button type="button" disabled={isBusy} onClick={() => saveAccess(user, "approved", "账号已恢复并重新授权。 ")} className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-emerald-200 px-3 py-2.5 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-60"><UserCheck className="h-4 w-4" />恢复为在用账号</button> : null}
                </div> : null}
              </article>
            );
          })}
          {!displayedUsers.length ? <div className="bg-card px-5 py-16 text-center text-sm text-muted-foreground md:col-span-2 xl:col-span-3"><ShieldCheck className="mx-auto mb-2 h-5 w-5" />当前分类没有账号。</div> : null}
        </div>
      </section>
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><UserRound className="h-4 w-4" />安全员通过任务获得执行权限；区域管理员和外部协作方必须绑定负责范围。</div>
    </div>
  );
}
