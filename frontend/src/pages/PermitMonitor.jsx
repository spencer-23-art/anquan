import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Clock3,
  FilePlus2,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import api, { buildProtectedFileUrl } from "../lib/axios";

const PERMIT_META = {
  hot_work_level1: { label: "动火一级票", note: "默认 8 小时" },
  hot_work_level2: { label: "动火二级票", note: "默认 3 天" },
  hot_work_level3: { label: "动火三级票", note: "默认 7 天" },
  height_level1: { label: "登高一级票", note: "默认 7 天" },
  height_level2: { label: "登高二级票", note: "默认 7 天" },
  height_level3: { label: "登高三级票", note: "默认 7 天" },
  height_special: { label: "特级登高票", note: "默认 8 小时" },
  confined_space: { label: "受限空间票", note: "默认当班且最长 12 小时" },
  lifting: { label: "吊装票", note: "默认 7 天" },
  excavation: { label: "动土票", note: "默认 7 天" },
  electrical: { label: "临电票", note: "默认 7 天" },
  other: { label: "其他票证", note: "默认 7 天" },
};

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("zh-CN");
}

function getPermitMeta(type) {
  return PERMIT_META[type] || { label: type || "未知票证", note: "默认 7 天" };
}

function getPermitProgress(startTime, endTime, now) {
  if (!startTime || !endTime) {
    return {
      remainingPercent: 0,
      statusTone: "expired",
      countdown: "未设置时限",
      expiresAt: Number.MAX_SAFE_INTEGER,
    };
  }

  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  const current = now.getTime();
  const total = Math.max(end - start, 1);
  const remaining = end - current;

  if (remaining <= 0) {
    return {
      remainingPercent: 0,
      statusTone: "expired",
      countdown: "已过期",
      expiresAt: end,
    };
  }

  const remainingPercent = Math.max(0, Math.min(100, (remaining / total) * 100));
  const totalMinutes = Math.floor(remaining / 60000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  let countdown = "";
  if (days > 0) {
    countdown = `${days}天 ${hours}小时`;
  } else if (hours > 0) {
    countdown = `${hours}小时 ${minutes}分钟`;
  } else {
    countdown = `${Math.max(minutes, 1)}分钟`;
  }

  return {
    remainingPercent,
    statusTone: remainingPercent > 20 ? "healthy" : "warning",
    countdown: `剩余 ${countdown}`,
    expiresAt: end,
  };
}

function toneClasses(tone) {
  switch (tone) {
    case "healthy":
      return {
        card: "border-slate-200 bg-white",
        badge: "bg-emerald-100 text-emerald-700",
        surface: "bg-emerald-50 text-emerald-700",
      };
    case "warning":
      return {
        card: "border-amber-300 bg-amber-50",
        badge: "bg-amber-100 text-amber-700",
        surface: "bg-amber-100 text-amber-800",
      };
    default:
      return {
        card: "border-slate-200 bg-slate-100",
        badge: "bg-slate-200 text-slate-600",
        surface: "bg-slate-200 text-slate-700",
      };
  }
}

function sortWeight(progress) {
  if (progress.statusTone === "warning") {
    return 0;
  }
  if (progress.statusTone === "healthy") {
    return 1;
  }
  return 2;
}

export default function PermitMonitor() {
  const [permits, setPermits] = useState([]);
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [showModal, setShowModal] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    type: "hot_work_level1",
    area_id: "",
    responsible_person: "",
    description: "",
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [permitRes, areaRes] = await Promise.all([api.get("/permits"), api.get("/areas")]);
      const areaList = areaRes.data || [];
      setPermits(permitRes.data || []);
      setAreas(areaList);
      setForm((current) => ({
        ...current,
        area_id: current.area_id || String(areaList[0]?.id || ""),
      }));
    } catch (error) {
      setMessage(error?.response?.data?.detail || "作业票加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const selectedTypeMeta = useMemo(() => getPermitMeta(form.type), [form.type]);

  const sortedPermits = useMemo(() => {
    return [...permits].sort((a, b) => {
      const progressA = getPermitProgress(a.start_time, a.end_time, now);
      const progressB = getPermitProgress(b.start_time, b.end_time, now);
      const weightA = sortWeight(progressA);
      const weightB = sortWeight(progressB);

      if (weightA !== weightB) {
        return weightA - weightB;
      }

      if (progressA.expiresAt !== progressB.expiresAt) {
        return progressA.expiresAt - progressB.expiresAt;
      }

      const startA = a.start_time ? new Date(a.start_time).getTime() : 0;
      const startB = b.start_time ? new Date(b.start_time).getTime() : 0;
      return startB - startA;
    });
  }, [permits, now]);

  const handleManualCreate = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      const payload = new FormData();
      payload.append("type", form.type);
      payload.append("area_id", form.area_id);
      payload.append("responsible_person", form.responsible_person);
      payload.append("description", form.description);

      await api.post("/permits/manual", payload);
      setShowModal(false);
      setForm((current) => ({
        ...current,
        responsible_person: "",
        description: "",
      }));
      setMessage("手动票证已创建，倒计时已开始。");
      await loadData();
    } catch (error) {
      setMessage(error?.response?.data?.detail || "手动票证创建失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePermit = async (permitId) => {
    if (!window.confirm("确定删除这张作业票吗？删除后无法恢复。")) {
      return;
    }

    try {
      await api.delete(`/permits/${permitId}`);
      setMessage("票证已删除。");
      await loadData();
    } catch (error) {
      setMessage(error?.response?.data?.detail || "删除票证失败");
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-sky-100 bg-[linear-gradient(135deg,#f7fbff_0%,#f8fcfb_55%,#fff8f0_100%)] p-6 shadow-[0_10px_35px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              作业许可监控
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              票证现在按到期紧急程度排序，越快到期越靠前，其次是正常有效，最后才是已过期。
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            <FilePlus2 size={18} />
            手动添加票证
          </button>
        </div>
      </section>

      {message ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          {message}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-3xl bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">
          正在加载作业票证...
        </div>
      ) : sortedPermits.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">
          目前还没有作业许可，新建后会立刻开始倒计时。
        </div>
      ) : (
        <div>
          <div className="mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            排序规则：即将到期排最前，方便你优先处理快失效的票证。
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {sortedPermits.map((permit) => {
              const meta = getPermitMeta(permit.type);
              const progress = getPermitProgress(permit.start_time, permit.end_time, now);
              const tone = toneClasses(progress.statusTone);

              return (
                <article
                  key={permit.id}
                  className={`overflow-hidden rounded-[24px] border shadow-[0_8px_24px_rgba(15,23,42,0.05)] ${tone.card}`}
                >
                  <div className="space-y-3 px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
                          Permit #{permit.id}
                        </div>
                        <h2 className="mt-1 text-base font-semibold text-slate-900">
                          {meta.label}
                        </h2>
                        <div className="mt-1 text-xs text-slate-500">
                          {permit.area?.name || "未分配区域"}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className={`rounded-full px-3 py-1 text-[11px] font-medium ${tone.badge}`}>
                          {progress.statusTone === "expired"
                            ? "已过期"
                            : progress.statusTone === "warning"
                              ? "即将到期"
                              : "有效中"}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeletePermit(permit.id)}
                          className="rounded-full p-2 text-slate-400 transition hover:bg-white/80 hover:text-rose-600"
                          title="删除票证"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-2xl bg-white/70 px-3 py-2">
                        <div className="flex items-center gap-2 text-[11px] text-slate-500">
                          <UserRound size={13} />
                          责任人
                        </div>
                        <div className="mt-1 text-sm font-medium text-slate-900">
                          {permit.responsible_person || "未填写"}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-white/70 px-3 py-2">
                        <div className="flex items-center gap-2 text-[11px] text-slate-500">
                          <Clock3 size={13} />
                          倒计时
                        </div>
                        <div className={`mt-1 inline-flex rounded-full px-3 py-1 text-[11px] font-medium ${tone.surface}`}>
                          {progress.countdown}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-2xl bg-white/70 px-3 py-2">
                        <div className="flex items-center gap-2 text-[11px] text-slate-500">
                          <CalendarClock size={13} />
                          生效时间
                        </div>
                        <div className="mt-1 text-xs text-slate-800">
                          {formatDateTime(permit.start_time)}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-white/70 px-3 py-2">
                        <div className="flex items-center gap-2 text-[11px] text-slate-500">
                          <ShieldCheck size={13} />
                          到期时间
                        </div>
                        <div className="mt-1 text-xs text-slate-800">
                          {formatDateTime(permit.end_time)}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl bg-white/70 px-3 py-2">
                      <div className="text-[11px] text-slate-500">描述</div>
                      <div className="mt-1 text-xs leading-5 text-slate-700">
                        {permit.description || "暂无补充说明"}
                      </div>
                    </div>
                  </div>

                  {permit.photo_url ? (
                    <a
                      href={buildProtectedFileUrl(permit.photo_url)}
                      target="_blank"
                      rel="noreferrer"
                      className="block overflow-hidden border-t border-black/5 bg-black/5"
                    >
                      <img
                        src={buildProtectedFileUrl(permit.photo_url)}
                        alt={meta.label}
                        className="h-80 w-full object-cover transition hover:scale-[1.01]"
                      />
                    </a>
                  ) : (
                    <div className="flex h-80 items-center justify-center border-t border-dashed border-slate-300 bg-white/50 px-4 text-sm text-slate-400">
                      暂无现场照片
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3 px-4 py-3 text-[11px] text-slate-500">
                    <span>{meta.note}</span>
                    <span>开票于 {formatDateTime(permit.start_time || permit.created_at)}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-[28px] bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">手动添加作业票</h2>
                <p className="mt-2 text-sm text-slate-500">
                  适用于无法由 AI 自动识别，但现场确实需要补录的许可票证。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <X size={18} />
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleManualCreate}>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  票证类型
                </label>
                <select
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                  value={form.type}
                  onChange={(event) => setForm({ ...form, type: event.target.value })}
                >
                  {Object.entries(PERMIT_META).map(([value, meta]) => (
                    <option key={value} value={value}>
                      {meta.label}
                    </option>
                  ))}
                </select>
                <div className="mt-2 text-xs text-slate-500">{selectedTypeMeta.note}</div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">区域</label>
                <select
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                  value={form.area_id}
                  onChange={(event) => setForm({ ...form, area_id: event.target.value })}
                >
                  {areas.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">责任人</label>
                <input
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                  value={form.responsible_person}
                  onChange={(event) =>
                    setForm({ ...form, responsible_person: event.target.value })
                  }
                  placeholder="请输入责任人姓名"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">描述</label>
                <textarea
                  className="min-h-28 w-full rounded-2xl border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  placeholder="补充这张票证对应的现场作业说明"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-700 transition hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "创建中..." : "创建票证"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
