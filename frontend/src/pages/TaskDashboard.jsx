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
import { useAuthStore } from "../stores/auth";

const PERMIT_MAP = {
  hot_work_level1: "动火一级票",
  hot_work_level2: "动火二级票",
  hot_work_level3: "普通动火票",
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

const MAX_PHOTO_BYTES = 1024 * 1024;

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("zh-CN");
}

function formatUploadTimeFromUrl(value) {
  const filename = decodeURIComponent(String(value || "").split("/").pop() || "");
  const match = filename.match(/(?:^|_)(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\d{0,6})?\.[^.]+$/);
  if (!match) {
    return "";
  }
  const [, year, month, day, hour, minute, second] = match;
  return formatDateTime(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
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

function photoUrls(value) {
  return String(value || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

function textOrFallback(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function statusValue(value) {
  return String(value || "").toLowerCase();
}

async function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("照片生成失败，请重试"));
      },
      "image/jpeg",
      quality
    );
  });
}

async function captureCompressedPhoto(video) {
  if (!video?.videoWidth || !video?.videoHeight) {
    throw new Error("摄像头画面还没准备好，请稍等一秒再拍。");
  }

  const widths = [1080, 900, 720, 600, 480, 360];
  const qualities = [0.62, 0.5, 0.4, 0.32, 0.24, 0.18];
  let bestBlob = null;

  for (const width of widths) {
    const scale = Math.min(1, width / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    for (const quality of qualities) {
      const blob = await canvasToBlob(canvas, quality);
      if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
      if (blob.size <= MAX_PHOTO_BYTES) return blob;
    }
  }

  if (bestBlob && bestBlob.size <= MAX_PHOTO_BYTES) return bestBlob;
  throw new Error(`照片压缩后仍超过 1MB，请稍微离远一点重拍。当前约 ${Math.ceil((bestBlob?.size || 0) / 1024)}KB`);
}

async function compressImageFile(file) {
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve(img);
    };
    img.onerror = () => reject(new Error("照片读取失败，请重拍。"));
    img.src = URL.createObjectURL(file);
  });

  const widths = [1080, 900, 720, 600, 480, 360];
  const qualities = [0.62, 0.5, 0.4, 0.32, 0.24, 0.18];
  let bestBlob = null;

  for (const width of widths) {
    const scale = Math.min(1, width / image.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of qualities) {
      const blob = await canvasToBlob(canvas, quality);
      if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
      if (blob.size <= MAX_PHOTO_BYTES) return blob;
    }
  }

  if (bestBlob && bestBlob.size <= MAX_PHOTO_BYTES) return bestBlob;
  throw new Error(`照片压缩后仍超过 1MB，请稍微离远一点重拍。当前约 ${Math.ceil((bestBlob?.size || 0) / 1024)}KB`);
}

function GuidanceBlock({ title, children, tone = "slate" }) {
  const toneClass =
    tone === "photo"
      ? "bg-cyan-50 text-cyan-950"
      : tone === "measure"
        ? "bg-orange-50 text-orange-950"
        : "bg-slate-50 text-slate-950";

  return (
    <div className={`rounded-lg px-3 py-2 ${toneClass}`}>
      <div className="mb-1 text-[10px] font-bold text-slate-800">{title}</div>
      <p className="whitespace-pre-wrap break-words text-xs leading-5 text-slate-700">
        {children}
      </p>
    </div>
  );
}

function PhotoGallery({
  value,
  alt,
  emptyText,
  heightClass = "h-36",
  gridClass = "grid-cols-2",
  onPreview,
  onAddPhoto,
}) {
  const urls = photoUrls(value);

  if (urls.length === 0 && !onAddPhoto) {
    return emptyText ? (
      <div className={`flex ${heightClass} items-center justify-center rounded-xl border border-dashed border-border bg-secondary/20 p-4 text-center text-xs text-muted-foreground`}>
        {emptyText}
      </div>
    ) : null;
  }

  return (
    <div className={`grid gap-2 ${gridClass}`}>
      {urls.map((url, index) => {
        const fullUrl = buildProtectedFileUrl(url);
        const photoTime = formatUploadTimeFromUrl(url);
        return (
          <button
            key={`${url}-${index}`}
            type="button"
            className={`group relative flex ${heightClass} cursor-zoom-in items-center justify-center overflow-hidden rounded-xl border border-border bg-slate-950/5 p-2 transition hover:border-primary/50 hover:bg-primary/5`}
            onClick={() => onPreview(fullUrl)}
            title="点击查看完整照片"
          >
            <img
              src={fullUrl}
              alt={`${alt}${urls.length > 1 ? ` ${index + 1}` : ""}`}
              className="max-h-full max-w-full object-contain transition group-hover:scale-[1.01]"
            />
            {photoTime ? (
              <span className="pointer-events-none absolute inset-x-1 bottom-1 rounded-lg bg-slate-950/75 px-1.5 py-0.5 text-center text-[10px] leading-4 text-white">
                拍照时间：{photoTime}
              </span>
            ) : null}
          </button>
        );
      })}
      {onAddPhoto && (
        <button
          type="button"
          onClick={onAddPhoto}
          className={`flex ${heightClass} items-center justify-center rounded-xl border border-dashed border-primary/40 bg-primary/5 text-primary transition hover:bg-primary/10 hover:shadow-inner`}
          title="添加照片"
        >
          <Camera className="h-6 w-6 opacity-60" />
        </button>
      )}
    </div>
  );
}

export default function TaskDashboard() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [expandedTask, setExpandedTask] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameraTarget, setCameraTarget] = useState(null);
  const [cameraStream, setCameraStream] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [permitResponsibleTarget, setPermitResponsibleTarget] = useState(null);
  const [permitResponsibleName, setPermitResponsibleName] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const captureInputRef = useRef(null);
  const { user } = useAuthStore();

  const fetchTasks = async () => {
    try {
      setLoadError("");
      const res = await api.get("/tasks");
      setTasks(res.data || []);
    } catch (err) {
      console.error("Failed to fetch tasks", err);
      setLoadError(err.response?.data?.detail || "任务数据加载失败，请检查网络后重试。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    const timer = setInterval(fetchTasks, 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
      videoRef.current.play?.().catch(() => {});
    }
  }, [cameraStream, cameraOpen]);

  useEffect(() => () => {
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
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

  const stopCamera = () => {
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraStream(null);
    setCameraOpen(false);
    setCameraTarget(null);
    setCameraError("");
  };

  const openCamera = async (target) => {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraTarget(target);
      setTimeout(() => captureInputRef.current?.click(), 0);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraTarget(target);
      setCameraStream(stream);
      setCameraOpen(true);
    } catch {
      setCameraTarget(target);
      setTimeout(() => captureInputRef.current?.click(), 0);
    }
  };

  const beginPermitPhoto = (task, permit, index) => {
    setPermitResponsibleTarget({ taskId: task.id, permit, index });
    setPermitResponsibleName(String(permit?.responsible_person || "").trim());
  };

  const confirmPermitResponsible = () => {
    const name = permitResponsibleName.trim();
    if (!permitResponsibleTarget) return;
    if (!name) {
      alert("请先填写作业票据负责人。");
      return;
    }
    const { taskId, permit, index } = permitResponsibleTarget;
    setPermitResponsibleTarget(null);
    openCamera({
      kind: "permit",
      taskId,
      index,
      responsible_person: name,
      description: permit?.description || permit?.reason || "",
    });
  };

  const uploadPhotoBlob = async (blob) => {
    if (!cameraTarget) return;
    const formData = new FormData();
    formData.append("photo", new File([blob], `${cameraTarget.kind}_${cameraTarget.id ?? cameraTarget.index}.jpg`, { type: "image/jpeg" }));

    if (cameraTarget.kind === "check") {
      formData.append("note", `Web端现场拍照，压缩后约 ${Math.ceil(blob.size / 1024)}KB`);
      await api.post(`/tasks/${cameraTarget.taskId}/items/${cameraTarget.id}/check`, formData);
    } else if (cameraTarget.kind === "add_photo") {
      await api.post(`/tasks/${cameraTarget.taskId}/items/${cameraTarget.id}/add-photo`, formData);
    } else {
      formData.append("responsible_person", cameraTarget.responsible_person || "");
      formData.append("description", cameraTarget.description || "");
      await api.post(`/tasks/${cameraTarget.taskId}/permits/${cameraTarget.index}/photo`, formData);
    }

    await fetchTasks();
  };

  const uploadCapturedPhoto = async () => {
    if (!cameraTarget || uploadingPhoto) return;
    setUploadingPhoto(true);
    setCameraError("");

    try {
      const blob = await captureCompressedPhoto(videoRef.current);
      await uploadPhotoBlob(blob);
      stopCamera();
    } catch (err) {
      setCameraError(err.response?.data?.detail || err.message || "拍照上传失败，请重试。");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleCaptureInput = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !cameraTarget || uploadingPhoto) return;
    setUploadingPhoto(true);
    try {
      const blob = await compressImageFile(file);
      await uploadPhotoBlob(blob);
      stopCamera();
    } catch (err) {
      alert(err.response?.data?.detail || err.message || "拍照上传失败，请重试。");
    } finally {
      setUploadingPhoto(false);
    }
  };

  return (
    <div className="space-y-6">
      <input
        ref={captureInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleCaptureInput}
      />
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">
          {user?.role === "admin" ? "任务执行监控" : "我的安全任务"}
        </h1>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>每 10 秒自动刷新</span>
          <button
            type="button"
            onClick={fetchTasks}
            disabled={loading}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            title="刷新任务"
            aria-label="刷新任务"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {loadError ? (
        <div role="alert" className="flex items-center justify-between gap-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{loadError}</span>
          <button type="button" onClick={fetchTasks} className="shrink-0 font-medium underline underline-offset-4">
            重试
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="py-20 text-center text-muted-foreground">正在加载任务数据...</div>
      ) : groupedTasks.length === 0 ? (
        <div className="glass-card border-dashed px-6 py-12 text-center text-sm text-slate-500">
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
                  const requiredPermits = task.required_permits || [];
                  const canOperate = task.assignee_id === user?.id || task.assignee?.id === user?.id;
                  const showAdminCompactRisk = user?.role === "admin";
                  const checkedCount = checklistItems.filter(
                    (item) => statusValue(item.status) === "checked"
                  ).length;
                  const progressWidth =
                    (checkedCount / Math.max(checklistItems.length, 1)) * 100;
                  const completedPermitCount = requiredPermits.filter(
                    (permit) => permit.permit_id && permit.photo_url
                  ).length;
                  const taskMeta = [
                    ["项目", task.project_name],
                    ["区域", task.area?.name || "未知区域"],
                    ["作业点", task.work_point],
                    ["工序", task.process_name],
                    ["执行人", task.assignee?.username || "-"],
                    ["创建时间", formatDateTime(task.created_at)],
                  ].filter(([, value]) => value);

                  return (
                    <div
                      key={task.id}
                      className="overflow-hidden glass-card transition-shadow hover:shadow-md"
                    >
                      <div
                        className="flex cursor-pointer flex-col gap-3 p-4 hover:bg-secondary/20 sm:flex-row sm:items-center sm:justify-between"
                        onClick={() =>
                          setExpandedTask(expandedTask === task.id ? null : task.id)
                        }
                      >
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
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

                          <div className="grid gap-1 text-xs text-muted-foreground sm:flex sm:flex-wrap sm:gap-x-4 sm:gap-y-1">
                            {taskMeta.map(([label, value]) => (
                              <span key={label}>{label}: {value}</span>
                            ))}
                          </div>
                        </div>

                        <div className="flex w-full items-center justify-between gap-3 sm:w-32 sm:flex-col sm:items-end sm:gap-2">
                          <div className="text-left text-xs font-bold text-primary sm:text-right">
                            <div>检查: {checkedCount} / {checklistItems.length}</div>
                            {requiredPermits.length ? (
                              <div className="mt-1 text-[10px] text-muted-foreground">
                                票证: {completedPermitCount} / {requiredPermits.length}
                              </div>
                            ) : null}
                          </div>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary sm:w-32 sm:flex-none">
                            <div
                              className="h-full bg-primary transition-all duration-500"
                              style={{ width: `${progressWidth}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      {expandedTask === task.id ? (
                        <div className="animate-in slide-in-from-top-2 space-y-6 border-t border-white/20 dark:border-white/10 bg-transparent p-4 fade-in">
                          {requiredPermits.length > 0 ? (
                            <div className="space-y-3">
                              <h3 className="text-sm font-bold text-foreground">
                                必须办理的作业许可 ({task.required_permits.length})
                              </h3>
                              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                                  {requiredPermits.map((permit, index) => {
                                  const isProcessed = !!(permit.permit_id && permit.photo_url);
                                  return (
                                    <div
                                      key={index}
                                      className="flex min-h-[260px] flex-col gap-3 glass-panel p-3"
                                    >
                                      <PhotoGallery
                                        value={permit.photo_url}
                                        alt="作业票证照片"
                                        emptyText={canOperate ? "点击加号调用摄像头现场拍照" : "等待执行人上传"}
                                        heightClass="h-40"
                                        gridClass="grid-cols-2"
                                        onPreview={setPreviewUrl}
                                        onAddPhoto={canOperate ? () => beginPermitPhoto(task, permit, index) : null}
                                      />

                                      <div className={`flex flex-1 flex-col justify-between gap-3 rounded-lg p-3 ${isProcessed ? "bg-emerald-500/5" : "bg-amber-500/5"}`}>
                                        <div className="space-y-2">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="rounded bg-blue-500/20 px-2 py-1 text-xs font-bold text-blue-700">
                                              {PERMIT_MAP[permit.type] || permit.type}
                                            </span>
                                            <span
                                              className={`rounded px-2 py-1 text-xs ${
                                                isProcessed
                                                  ? "bg-green-500/20 text-green-600"
                                                  : "bg-amber-500/20 text-amber-600"
                                              }`}
                                            >
                                              {isProcessed ? "已办理" : "未办理"}
                                            </span>
                                            {permit.permit_id && (
                                              <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">
                                                ID: #{permit.permit_id}
                                              </span>
                                            )}
                                          </div>
                                          <div className="text-xs leading-6 text-muted-foreground">
                                            <div>责任人: {permit.responsible_person || "-"}</div>
                                            {permit.description || permit.reason ? (
                                              <div>作业描述: {permit.description || permit.reason}</div>
                                            ) : null}
                                            {permit.end_time ? (
                                              <div>有效期至: {formatDateTime(permit.end_time)}</div>
                                            ) : null}
                                          </div>
                                        </div>
                                        <div className="text-[10px] text-muted-foreground">
                                          {photoUrls(permit.photo_url).length || 0} 张照片
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}

                          <div className="space-y-3">
                            <h3 className="text-sm font-bold text-foreground">风险巡检清单</h3>
                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                              {checklistItems.map((item, index) => (
                                <div
                                  key={index}
                                  className={`relative flex flex-col gap-3 glass-panel p-3 ${
                                    showAdminCompactRisk ? "min-h-[260px]" : "min-h-[420px]"
                                  }`}
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
                                      {statusValue(item.status) === "checked" ? "已检查" : "未检查"}
                                    </span>
                                  </div>

                                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                                    <div className="mb-1 text-[10px] font-bold text-slate-500">
                                      风险描述
                                    </div>
                                    <p className="whitespace-pre-wrap break-words text-xs font-medium leading-5 text-foreground">
                                      {item.risk_description || "暂无风险描述"}
                                    </p>
                                  </div>

                                  {!showAdminCompactRisk ? (
                                    <>
                                      <GuidanceBlock title="如何排查">
                                        {textOrFallback(
                                          item.inspection_points,
                                          "按后台下发的风险要求，对人员、设备、环境和防护措施逐项核查，确认无异常。"
                                        )}
                                      </GuidanceBlock>

                                      <GuidanceBlock title="必须拍什么照片" tone="photo">
                                        {textOrFallback(
                                          item.photo_requirements,
                                          "拍摄风险点全景、关键防护措施和整改后状态，确保照片能证明现场已经排查。"
                                        )}
                                      </GuidanceBlock>

                                      <GuidanceBlock title="发现问题怎么处理" tone="measure">
                                        {textOrFallback(
                                          item.measure,
                                          "发现问题立即停止相关作业，通知责任人整改，复查合格后再允许继续施工。"
                                        )}
                                      </GuidanceBlock>
                                    </>
                                  ) : null}

                                  <div className="mt-2 space-y-2">
                                    <PhotoGallery
                                      value={item.photo_url}
                                      alt="巡检照片"
                                      emptyText={canOperate ? "点击加号调用摄像头现场拍照" : "等待执行人上传"}
                                      heightClass="h-28"
                                      gridClass="grid-cols-2"
                                      onPreview={setPreviewUrl}
                                      onAddPhoto={canOperate ? () => openCamera({ 
                                          kind: statusValue(item.status) === "checked" ? "add_photo" : "check", 
                                          taskId: task.id, 
                                          id: item.id 
                                      }) : null}
                                    />

                                    {item.note ? (
                                      <div className="rounded bg-secondary/30 p-1.5 text-[10px] text-muted-foreground">
                                        备注: {item.note}
                                      </div>
                                    ) : null}

                                    {statusValue(item.status) === "checked" && item.checked_at ? (
                                      <div className="text-[10px] italic text-muted-foreground">
                                        完成时间: {formatDateTime(item.checked_at)}
                                      </div>
                                    ) : null}
                                  </div>
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

      {permitResponsibleTarget ? (
        <div className="fixed inset-0 z-[105] flex items-center justify-center bg-black/40 p-4 backdrop-blur-md">
          <div className="w-full max-w-md glass-card p-6 shadow-2xl">
            <div className="text-lg font-black text-slate-900">填写作业票据负责人</div>
            <div className="mt-2 text-sm leading-6 text-slate-500">
              负责人可以是施工员或实际作业负责人，填写后再现场拍照办理。
            </div>
            <input
              type="text"
              value={permitResponsibleName}
              onChange={(event) => setPermitResponsibleName(event.target.value)}
              placeholder="请输入负责人姓名"
              className="mt-4 w-full apple-input px-3 py-2 text-sm font-bold text-slate-900 outline-none"
              autoFocus
            />
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPermitResponsibleTarget(null)}
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-200"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmPermitResponsible}
                className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-teal-700"
              >
                去拍照
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {previewUrl ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
          onClick={() => setPreviewUrl(null)}
        >
          <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setPreviewUrl(null)}
              className="absolute -right-2 -top-12 rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white md:-right-12 md:top-0"
            >
              <X size={24} />
            </button>
            <img src={previewUrl} alt="Preview" className="max-h-[90vh] max-w-full rounded-lg object-contain" />
          </div>
        </div>
      ) : null}

      {cameraOpen ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-white">
              <div>
                <div className="text-sm font-bold">现场实时拍照</div>
                <div className="text-xs text-white/60">Web 端会压缩到 200KB 以内再上传</div>
              </div>
              <button type="button" onClick={stopCamera} className="rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <div className="relative bg-black">
              {cameraError ? (
                <div className="flex min-h-[320px] items-center justify-center p-6 text-center text-sm leading-6 text-rose-100">
                  {cameraError}
                </div>
              ) : (
                <video ref={videoRef} playsInline muted className="max-h-[68vh] w-full bg-black object-contain" />
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 bg-slate-950 px-4 py-4">
              <button
                type="button"
                onClick={uploadCapturedPhoto}
                disabled={uploadingPhoto || !!cameraError}
                className="inline-flex min-w-36 items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploadingPhoto ? "正在上传..." : "拍照并上传"}
              </button>
              <button
                type="button"
                onClick={stopCamera}
                disabled={uploadingPhoto}
                className="rounded-full border border-white/20 px-5 py-3 text-sm font-bold text-white/80 transition hover:bg-white/10 disabled:opacity-50"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
