import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  Camera,
  Clock3,
  FilePlus2,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import api, { buildProtectedFileUrl } from "../lib/axios";
import { compressImage } from "../lib/imageCompressor";

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
  return value ? new Date(value).toLocaleString("zh-CN") : "-";
}

function getPermitMeta(type) {
  return PERMIT_META[type] || { label: type || "未知票证", note: "默认 7 天" };
}

function getPermitProgress(startTime, endTime, now) {
  if (!startTime || !endTime) {
    return { remainingPercent: 0, statusTone: "expired", countdown: "未设置时限", expiresAt: Number.MAX_SAFE_INTEGER };
  }

  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  const remaining = end - now.getTime();
  const total = Math.max(end - start, 1);

  if (remaining <= 0) {
    return { remainingPercent: 0, statusTone: "expired", countdown: "已过期", expiresAt: end };
  }

  const remainingPercent = Math.max(0, Math.min(100, (remaining / total) * 100));
  const totalMinutes = Math.floor(remaining / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const countdown = days > 0 ? `${days}天 ${hours}小时` : hours > 0 ? `${hours}小时 ${minutes}分钟` : `${Math.max(minutes, 1)}分钟`;

  return {
    remainingPercent,
    statusTone: remainingPercent <= 20 ? "warning" : "healthy",
    countdown: `剩余 ${countdown}`,
    expiresAt: end,
  };
}

function toneClasses(tone) {
  if (tone === "healthy") {
    return {
      card: "border-slate-200 bg-white",
      badge: "bg-emerald-100 text-emerald-700",
      surface: "bg-emerald-50 text-emerald-700",
    };
  }
  if (tone === "warning") {
    return {
      card: "border-amber-300 bg-amber-50",
      badge: "bg-amber-100 text-amber-800",
      surface: "bg-amber-100 text-amber-900",
    };
  }
  return {
    card: "border-slate-200 bg-slate-100",
    badge: "bg-slate-200 text-slate-600",
    surface: "bg-slate-200 text-slate-700",
  };
}

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

export default function PermitMonitor() {
  const [permits, setPermits] = useState([]);
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [showModal, setShowModal] = useState(false);
  const [message, setMessage] = useState("");
  const [photoAction, setPhotoAction] = useState(null);
  const [previewPhoto, setPreviewPhoto] = useState(null);
  const fileInputRef = useRef(null);
  const manualPhotoRef = useRef(null);
  const photoClickTimerRef = useRef(null);
  const [form, setForm] = useState({
    type: "hot_work_level1",
    area_id: "",
    responsible_person: "",
    description: "",
  });

  const areaOptions = useMemo(() => buildAreaOptions(areas), [areas]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [permitRes, areaRes] = await Promise.all([api.get("/permits"), api.get("/areas")]);
      const areaList = areaRes.data || [];
      setPermits(permitRes.data || []);
      setAreas(areaList);
      setForm((current) => ({ ...current, area_id: current.area_id || String(areaList[0]?.id || "") }));
    } catch (error) {
      setMessage(error?.response?.data?.detail || "作业许可加载失败");
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

  useEffect(() => {
    return () => {
      if (photoClickTimerRef.current) {
        window.clearTimeout(photoClickTimerRef.current);
      }
    };
  }, []);

  const sortedPermits = useMemo(() => {
    return [...permits].sort((a, b) => {
      const progressA = getPermitProgress(a.start_time, a.end_time, now);
      const progressB = getPermitProgress(b.start_time, b.end_time, now);
      const weight = { warning: 0, healthy: 1, expired: 2 };
      return weight[progressA.statusTone] - weight[progressB.statusTone] || progressA.expiresAt - progressB.expiresAt;
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
      if (manualPhotoRef.current?.files?.[0]) {
        const compressed = await compressImage(manualPhotoRef.current.files[0]);
        payload.append("photo", compressed);
      }
      await api.post("/permits/manual", payload);
      setShowModal(false);
      setForm((current) => ({ ...current, responsible_person: "", description: "" }));
      setMessage("作业许可已创建，倒计时从当天 7 点开始。");
      await loadData();
    } catch (error) {
      setMessage(error?.response?.data?.detail || error?.message || "作业许可创建失败");
    } finally {
      setSaving(false);
    }
  };

  const openPhotoPicker = (permitId, action) => {
    setPhotoAction({ permitId, action });
    fileInputRef.current?.click();
  };

  const handlePhotoClick = (permitId) => {
    if (photoClickTimerRef.current) {
      window.clearTimeout(photoClickTimerRef.current);
    }
    photoClickTimerRef.current = window.setTimeout(() => {
      openPhotoPicker(permitId, "photo");
      photoClickTimerRef.current = null;
    }, 220);
  };

  const handlePhotoDoubleClick = (permit, meta) => {
    if (photoClickTimerRef.current) {
      window.clearTimeout(photoClickTimerRef.current);
      photoClickTimerRef.current = null;
    }
    if (!permit.photo_url) {
      openPhotoPicker(permit.id, "photo");
      return;
    }
    setPreviewPhoto({
      url: buildProtectedFileUrl(permit.photo_url),
      title: meta.label,
      area: permit.area?.name || "未分配区域",
    });
  };

  const handlePhotoSelected = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !photoAction) return;
    const compressed = await compressImage(file);
    const payload = new FormData();
    payload.append("photo", compressed);
    try {
      const url = photoAction.action === "renew" ? `/permits/${photoAction.permitId}/renew` : `/permits/${photoAction.permitId}/photo`;
      await api.post(url, payload);
      setMessage(photoAction.action === "renew" ? "续票成功，新许可照片已更新。" : "许可照片已更新。");
      await loadData();
    } catch (error) {
      setMessage(error?.response?.data?.detail || error?.message || "照片上传失败");
    } finally {
      event.target.value = "";
      setPhotoAction(null);
    }
  };

  const handleRenew = async (permitId) => {
    try {
      await api.post(`/permits/${permitId}/renew`, new FormData());
      setMessage("续票成功，有效期已按当天 7 点重新计算。");
      await loadData();
    } catch (error) {
      setMessage(error?.response?.data?.detail || "续票失败");
    }
  };

  const handleDeletePermit = async (permitId) => {
    if (!window.confirm("确定删除这张作业许可吗？删除后无法恢复。")) return;
    try {
      await api.delete(`/permits/${permitId}`);
      setMessage("作业许可已删除。");
      await loadData();
    } catch (error) {
      setMessage(error?.response?.data?.detail || "删除作业许可失败");
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-[18px] border border-sky-100 bg-[linear-gradient(135deg,#f7fbff_0%,#f8fcfb_55%,#fff8f0_100%)] p-5 shadow-sm dark:border-border dark:bg-[linear-gradient(135deg,#26313c_0%,#273530_55%,#342f26_100%)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">作业许可监控</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">剩余有效期小于等于 20% 自动黄色提醒，快到期的票证排在最前。</p>
          </div>
          <button type="button" onClick={() => setShowModal(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800">
            <FilePlus2 size={18} />
            手动添加票证
          </button>
        </div>
      </section>

      {message ? <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">{message}</div> : null}

      {loading ? (
        <div className="rounded-2xl bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">正在加载作业许可...</div>
      ) : sortedPermits.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">目前还没有作业许可。</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sortedPermits.map((permit) => {
            const meta = getPermitMeta(permit.type);
            const progress = getPermitProgress(permit.start_time, permit.end_time, now);
            const tone = toneClasses(progress.statusTone);
            return (
              <article key={permit.id} className={`overflow-hidden rounded-2xl border shadow-sm ${tone.card}`}>
                <div className="space-y-3 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Permit #{permit.id}</div>
                      <h2 className="mt-1 text-base font-semibold text-slate-900">{meta.label}</h2>
                      <div className="mt-1 text-xs text-slate-500">{permit.area?.name || "未分配区域"}</div>
                    </div>
                    <div className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-medium ${tone.badge}`}>
                      {progress.statusTone === "expired" ? "已过期" : progress.statusTone === "warning" ? "即将到期" : "有效中"}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-white/70 px-3 py-2">
                      <div className="flex items-center gap-2 text-[11px] text-slate-500"><UserRound size={13} />责任人</div>
                      <div className="mt-1 text-sm font-medium text-slate-900">{permit.responsible_person || "未填写"}</div>
                    </div>
                    <div className="rounded-xl bg-white/70 px-3 py-2">
                      <div className="flex items-center gap-2 text-[11px] text-slate-500"><Clock3 size={13} />倒计时</div>
                      <div className={`mt-1 inline-flex rounded-full px-3 py-1 text-[11px] font-medium ${tone.surface}`}>{progress.countdown}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-white/70 px-3 py-2">
                      <div className="flex items-center gap-2 text-[11px] text-slate-500"><CalendarClock size={13} />生效时间</div>
                      <div className="mt-1 text-xs text-slate-800">{formatDateTime(permit.start_time)}</div>
                    </div>
                    <div className="rounded-xl bg-white/70 px-3 py-2">
                      <div className="flex items-center gap-2 text-[11px] text-slate-500"><ShieldCheck size={13} />到期时间</div>
                      <div className="mt-1 text-xs text-slate-800">{formatDateTime(permit.end_time)}</div>
                    </div>
                  </div>

                  <div className="rounded-xl bg-white/70 px-3 py-2">
                    <div className="text-[11px] text-slate-500">描述</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-700">{permit.description || "暂无补充说明"}</div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handlePhotoClick(permit.id)}
                  onDoubleClick={() => handlePhotoDoubleClick(permit, meta)}
                  className="block w-full overflow-hidden border-t border-black/5 bg-black/5 text-left"
                  title="单击重新上传，双击放大查看"
                >
                  {permit.photo_url ? (
                    <div className="flex h-72 w-full items-center justify-center bg-slate-950/5">
                      <img src={buildProtectedFileUrl(permit.photo_url)} alt={meta.label} className="h-full w-full object-contain" />
                    </div>
                  ) : (
                    <div className="flex h-72 flex-col items-center justify-center gap-2 border-t border-dashed border-slate-300 bg-white/50 px-4 text-sm text-slate-400">
                      <Camera size={24} />
                      上传许可照片
                    </div>
                  )}
                </button>

                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[11px] text-slate-500">
                  <span>{meta.note}</span>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => handleRenew(permit.id)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-slate-700 hover:bg-white/70">
                      <RefreshCcw size={13} />续票
                    </button>
                    <button type="button" onClick={() => openPhotoPicker(permit.id, "renew")} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-slate-700 hover:bg-white/70">
                      <Upload size={13} />续票换照
                    </button>
                    <button type="button" onClick={() => handleDeletePermit(permit.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/70 hover:text-rose-600">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoSelected} />

      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">手动添加作业票</h2>
                <p className="mt-2 text-sm text-slate-500">用于补录现场已经办理或必须办理的许可票证。</p>
              </div>
              <button type="button" onClick={() => setShowModal(false)} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleManualCreate}>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">票证类型</span>
                <select className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
                  {Object.entries(PERMIT_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">区域</span>
                <select className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900" value={form.area_id} onChange={(event) => setForm({ ...form, area_id: event.target.value })}>
                  {areaOptions.map((area) => <option key={area.id} value={area.id}>{`${"　".repeat(area.depth)}${area.name}`}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">责任人</span>
                <input className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900" value={form.responsible_person} onChange={(event) => setForm({ ...form, responsible_person: event.target.value })} placeholder="请输入责任人姓名" />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">描述</span>
                <textarea className="min-h-24 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="补充这张票证对应的现场作业说明" />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">许可照片</span>
                <input ref={manualPhotoRef} type="file" accept="image/*" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
              </label>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 transition hover:bg-slate-50">取消</button>
                <button type="submit" disabled={saving} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60">{saving ? "创建中..." : "创建票证"}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {previewPhoto ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
          onClick={() => setPreviewPhoto(null)}
        >
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">{previewPhoto.title}</div>
                <div className="mt-1 text-xs text-slate-500">{previewPhoto.area}</div>
              </div>
              <button type="button" onClick={() => setPreviewPhoto(null)} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950 p-3">
              <img src={previewPhoto.url} alt={previewPhoto.title} className="max-h-[78vh] max-w-full object-contain" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
