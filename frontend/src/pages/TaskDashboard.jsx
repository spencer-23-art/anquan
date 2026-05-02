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

const MAX_PHOTO_BYTES = 200 * 1024;

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
  throw new Error(`照片压缩后仍超过 200KB，请稍微离远一点重拍。当前约 ${Math.ceil((bestBlob?.size || 0) / 1024)}KB`);
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
  throw new Error(`照片压缩后仍超过 200KB，请稍微离远一点重拍。当前约 ${Math.ceil((bestBlob?.size || 0) / 1024)}KB`);
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
}) {
  const urls = photoUrls(value);

  if (urls.length === 0) {
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
        return (
          <button
            key={`${url}-${index}`}
            type="button"
            className={`group flex ${heightClass} cursor-zoom-in items-center justify-center overflow-hidden rounded-xl border border-border bg-slate-950/5 p-2 transition hover:border-primary/50 hover:bg-primary/5`}
            onClick={() => onPreview(fullUrl)}
            title="点击查看完整照片"
          >
            <img
              src={fullUrl}
              alt={`${alt}${urls.length > 1 ? ` ${index + 1}` : ""}`}
              className="max-h-full max-w-full object-contain transition group-hover:scale-[1.01]"
            />
          </button>
        );
      })}
    </div>
  );
}

export default function TaskDashboard() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedTask, setExpandedTask] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameraTarget, setCameraTarget] = useState(null);
  const [cameraStream, setCameraStream] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const captureInputRef = useRef(null);
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
    } catch (err) {
      setCameraTarget(target);
      setTimeout(() => captureInputRef.current?.click(), 0);
    }
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
                  const canOperate = task.assignee_id === user?.id || task.assignee?.id === user?.id;
                  const checkedCount = checklistItems.filter(
                    (item) => statusValue(item.status) === "checked"
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
                                    className="flex min-h-[260px] flex-col gap-3 rounded-xl border border-blue-500/30 bg-background p-3 shadow-sm"
                                  >
                                    <PhotoGallery
                                      value={permit.photo_url}
                                      alt="作业票证照片"
                                      emptyText="暂无办票照片"
                                      heightClass="h-40"
                                      gridClass="grid-cols-2"
                                      onPreview={setPreviewUrl}
                                    />
                                    {canOperate ? (
                                      <button
                                        type="button"
                                        onClick={() => openCamera({ kind: "permit", taskId: task.id, index })}
                                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-teal-700"
                                      >
                                        <Camera className="h-4 w-4" />
                                        {permit.permit_id ? "重拍作业票据" : "拍照办理作业票据"}
                                      </button>
                                    ) : null}

                                    <div className="flex flex-1 flex-col justify-between gap-3 rounded-lg bg-blue-500/5 p-3">
                                      <div className="space-y-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="rounded bg-blue-500/20 px-2 py-1 text-xs font-bold text-blue-700">
                                            {PERMIT_MAP[permit.type] || permit.type}
                                          </span>
                                          <span
                                            className={`rounded px-2 py-1 text-xs ${
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
                                        <div className="text-xs leading-6 text-muted-foreground">
                                          <div>责任人: {permit.responsible_person || "-"}</div>
                                          <div>有效期至: {formatDateTime(permit.end_time)}</div>
                                        </div>
                                      </div>
                                      <div className="text-[10px] text-muted-foreground">
                                        {photoUrls(permit.photo_url).length || 0} 张照片
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          <div className="space-y-3">
                            <h3 className="text-sm font-bold text-foreground">风险巡检清单</h3>
                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                              {checklistItems.map((item, index) => (
                                <div
                                  key={index}
                                  className="relative flex min-h-[420px] flex-col gap-3 rounded-xl border border-border bg-background p-3 shadow-sm"
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

                                  {statusValue(item.status) === "checked" ? (
                                    <div className="mt-2 space-y-2">
                                      <PhotoGallery
                                        value={item.photo_url}
                                        alt="巡检照片"
                                        heightClass="h-28"
                                        gridClass="grid-cols-2"
                                        onPreview={setPreviewUrl}
                                      />

                                      {canOperate ? (
                                        <button
                                          type="button"
                                          onClick={() => openCamera({ kind: "add_photo", taskId: task.id, id: item.id })}
                                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-teal-300 bg-teal-50 px-3 py-2 text-xs font-bold text-teal-700 transition hover:bg-teal-100"
                                        >
                                          <Camera className="h-4 w-4" />
                                          追加现场照片
                                        </button>
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
                                    <div className="mt-2 flex h-32 flex-col items-center justify-center gap-2 rounded border border-dashed border-border p-3 text-center text-[10px] text-muted-foreground">
                                      {canOperate ? (
                                        <button
                                          type="button"
                                          onClick={() => openCamera({ kind: "check", taskId: task.id, id: item.id })}
                                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-teal-700"
                                        >
                                          <Camera className="h-4 w-4" />
                                          现场拍照确认
                                        </button>
                                      ) : (
                                        "等待执行人上传"
                                      )}
                                      {canOperate ? <span>只能调用摄像头现场拍照</span> : null}
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
