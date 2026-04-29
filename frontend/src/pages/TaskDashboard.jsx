import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import api, { buildProtectedFileUrl } from "../lib/axios";
import { useAuthStore } from "../stores/auth";

const PERMIT_MAP = {
  hot_work_level1: "动火一级票",
  hot_work_level2: "动火二级票",
  hot_work_level3: "动火三级票",
  height_level1: "登高一级票",
  height_level2: "登高二级票",
  height_level3: "登高三级票",
  height_special: "特级登高票",
  confined_space: "受限空间票",
  lifting: "吊装票",
  excavation: "动土票",
  electrical: "临电票",
  other: "通用票证",
};

const SEVERITY_MAP = {
  high: "重大风险",
  medium: "一般风险",
  low: "低度风险",
};

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("zh-CN");
}

function formatDayLabel(value) {
  return new Date(value).toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

function getDayKey(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function groupTasksByDay(tasks) {
  const groups = new Map();

  tasks.forEach((task) => {
    const source = task.created_at || new Date().toISOString();
    const key = getDayKey(source);

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: formatDayLabel(source),
        items: [],
      });
    }

    groups.get(key).items.push(task);
  });

  return Array.from(groups.values()).sort((a, b) => (a.key < b.key ? 1 : -1));
}

function DateDivider({ label, count }) {
  return (
    <div className="mb-4 mt-8 first:mt-0">
      <div className="flex items-center gap-4">
        <div className="shrink-0 rounded-full bg-slate-900 px-4 py-1 text-sm font-medium text-white">
          {label}
        </div>
        <div className="text-xs text-slate-500">{count} 条任务</div>
        <div className="h-px flex-1 bg-slate-200" />
      </div>
    </div>
  );
}

export default function TaskDashboard() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedTask, setExpandedTask] = useState(null);
  const { user } = useAuthStore();

  const fetchTasks = async () => {
    try {
      const res = await api.get("/tasks");
      setTasks(res.data || []);
    } catch (err) {
      console.error("Failed to fetch tasks", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    const timer = setInterval(fetchTasks, 10000);
    return () => clearInterval(timer);
  }, []);

  const groupedTasks = useMemo(() => groupTasksByDay(tasks), [tasks]);

  const getStatusBadge = (status) => {
    switch (status) {
      case "pending":
        return (
          <span className="rounded bg-yellow-500/20 px-2 py-1 text-xs text-yellow-600">
            待处理
          </span>
        );
      case "in_progress":
        return (
          <span className="rounded bg-blue-500/20 px-2 py-1 text-xs text-blue-600">
            执行中
          </span>
        );
      case "completed":
        return (
          <span className="rounded bg-green-500/20 px-2 py-1 text-xs text-green-600">
            已完成
          </span>
        );
      default:
        return null;
    }
  };

  const handleDelete = async (event, id) => {
    event.stopPropagation();
    if (!window.confirm("确定要删除该任务吗？此操作不可撤销。")) {
      return;
    }

    try {
      await api.delete(`/tasks/${id}`);
      fetchTasks();
    } catch (err) {
      alert(`删除失败: ${err.response?.data?.detail || "未知错误"}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">
          {user?.role === "admin" ? "任务执行监控" : "我的安全任务"}
        </h1>
        <div className="text-xs text-muted-foreground">每 10 秒自动刷新</div>
      </div>

      {loading ? (
        <div className="py-20 text-center text-muted-foreground">正在加载任务数据...</div>
      ) : groupedTasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">
          当前还没有任务记录。
        </div>
      ) : (
        <div>
          {groupedTasks.map((group) => (
            <section key={group.key} className="mb-10">
              <DateDivider label={group.label} count={group.items.length} />

              <div className="grid gap-4">
                {group.items.map((task) => {
                  const checklistItems = task.checklist_items || [];
                  const checkedCount = checklistItems.filter(
                    (item) => item.status === "checked"
                  ).length;
                  const progressWidth =
                    (checkedCount / Math.max(checklistItems.length, 1)) * 100;

                  return (
                    <div
                      key={task.id}
                      className="overflow-hidden rounded-xl border border-border bg-card transition-all hover:shadow-md"
                    >
                      <div
                        className="flex cursor-pointer items-center justify-between p-4 hover:bg-secondary/20"
                        onClick={() =>
                          setExpandedTask(expandedTask === task.id ? null : task.id)
                        }
                      >
                        <div className="flex-1">
                          <div className="mb-1 flex items-center gap-3">
                            <span className="font-bold text-foreground">{task.title}</span>
                            {getStatusBadge(task.status)}
                            {user?.role === "admin" && (
                              <button
                                onClick={(event) => handleDelete(event, task.id)}
                                className="ml-auto rounded p-1.5 text-destructive transition-colors hover:bg-destructive/10 hover:text-destructive/80"
                                title="删除任务"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>

                          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                            <span>区域: {task.area?.name || "未知区域"}</span>
                            <span>执行人: {task.assignee?.username || "-"}</span>
                            <span>创建时间: {formatDateTime(task.created_at)}</span>
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-2">
                          <div className="text-xs font-bold text-primary">
                            进度: {checkedCount} / {checklistItems.length}
                          </div>
                          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-secondary">
                            <div
                              className="h-full bg-primary transition-all duration-500"
                              style={{ width: `${progressWidth}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      {expandedTask === task.id ? (
                        <div className="animate-in slide-in-from-top-2 space-y-6 border-t border-border bg-secondary/10 p-4 fade-in">
                          {task.associated_permits && task.associated_permits.length > 0 ? (
                            <div className="space-y-3">
                              <h3 className="text-sm font-bold text-foreground">
                                关联作业票证 ({task.associated_permits.length})
                              </h3>
                              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                                {task.associated_permits.map((permit, index) => (
                                  <div
                                    key={index}
                                    className="flex flex-col gap-2 rounded-lg border border-blue-500/30 bg-background p-3"
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-bold text-blue-600">
                                        {PERMIT_MAP[permit.type] || permit.type}
                                      </span>
                                      <span
                                        className={`rounded px-1.5 py-0.5 text-[10px] ${
                                          permit.status === "active"
                                            ? "bg-green-500/20 text-green-600"
                                            : permit.status === "pending"
                                              ? "bg-yellow-500/20 text-yellow-600"
                                              : "bg-destructive/20 text-destructive"
                                        }`}
                                      >
                                        {permit.status === "active"
                                          ? "已生效"
                                          : permit.status === "pending"
                                            ? "待激活"
                                            : "已失效"}
                                      </span>
                                    </div>

                                      {permit.photo_url ? (
                                        <img
                                          src={buildProtectedFileUrl(permit.photo_url)}
                                          alt="Permit Capture"
                                          className="h-32 w-full cursor-zoom-in rounded object-cover shadow-inner"
                                          onClick={() =>
                                            window.open(
                                              buildProtectedFileUrl(permit.photo_url),
                                              "_blank"
                                            )
                                          }
                                      />
                                    ) : (
                                      <div className="flex h-32 items-center justify-center rounded border border-dashed border-border bg-secondary/20 p-4 text-center text-[10px] text-muted-foreground">
                                        暂无办票照片
                                      </div>
                                    )}

                                    <div className="text-[10px] text-muted-foreground">
                                      责任人: {permit.responsible_person || "-"}
                                    </div>
                                    <div className="text-[10px] italic text-primary">
                                      有效期至: {formatDateTime(permit.end_time)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          <div className="space-y-3">
                            <h3 className="text-sm font-bold text-foreground">风险巡检清单</h3>
                            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                              {checklistItems.map((item, index) => (
                                <div
                                  key={index}
                                  className="relative flex flex-col gap-2 rounded-lg border border-border bg-background p-3"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <span
                                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                        item.severity === "high"
                                          ? "bg-destructive/20 text-destructive"
                                          : item.severity === "medium"
                                            ? "bg-yellow-500/20 text-yellow-600"
                                            : "bg-green-500/10 text-green-600"
                                      }`}
                                    >
                                      {SEVERITY_MAP[item.severity] || item.severity}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {item.status === "checked" ? "已检查" : "未检查"}
                                    </span>
                                  </div>

                                  <p className="text-xs font-medium text-foreground">
                                    {item.risk_description}
                                  </p>

                                  {item.status === "checked" ? (
                                    <div className="mt-2 space-y-2">
                                      {item.photo_url ? (
                                        <img
                                          src={buildProtectedFileUrl(item.photo_url)}
                                          alt="Inspection"
                                          className="h-32 w-full cursor-zoom-in rounded object-cover hover:brightness-110"
                                          onClick={() =>
                                            window.open(
                                              buildProtectedFileUrl(item.photo_url),
                                              "_blank"
                                            )
                                          }
                                        />
                                      ) : null}

                                      {item.note ? (
                                        <div className="rounded bg-secondary/30 p-1.5 text-[10px] text-muted-foreground">
                                          备注: {item.note}
                                        </div>
                                      ) : null}

                                      <div className="text-[10px] italic text-muted-foreground">
                                        完成时间: {formatDateTime(item.checked_at)}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="mt-2 flex h-32 items-center justify-center rounded border border-dashed border-border text-[10px] text-muted-foreground">
                                      等待上传
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
