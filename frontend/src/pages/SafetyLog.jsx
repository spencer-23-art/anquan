import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Download, FileText, Loader2, RotateCcw, Share2, UserRound } from "lucide-react";
import api from "../lib/axios";
import { useAuthStore } from "../stores/auth";

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function displayName(user) {
  return user?.real_name || user?.username || "-";
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

export default function SafetyLog() {
  const currentUser = useAuthStore((state) => state.user);
  const isAdmin = currentUser?.role === "admin";
  const [logDate, setLogDate] = useState(todayStr());
  const [selectedUserId, setSelectedUserId] = useState("");
  const [inspectors, setInspectors] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("success");

  const selectedInspector = useMemo(
    () => inspectors.find((item) => String(item.id) === String(selectedUserId)),
    [inspectors, selectedUserId]
  );

  const loadInspectors = useCallback(async () => {
    if (!isAdmin) return;
    const { data } = await api.get("/users", { params: { status_filter: "approved" } });
    const approvedInspectors = (data || []).filter((item) => item.role === "inspector");
    setInspectors(approvedInspectors);
    setSelectedUserId((current) => current || String(approvedInspectors[0]?.id || ""));
  }, [isAdmin]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const params = { limit: 80 };
      if (isAdmin && selectedUserId) {
        params.user_id = selectedUserId;
      }
      const { data } = await api.get("/safety-logs/history", { params });
      setHistory(data || []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [isAdmin, selectedUserId]);

  useEffect(() => {
    loadInspectors().catch(() => {});
  }, [loadInspectors]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const getCurrentPosition = async () => {
    if (!navigator.geolocation) return {};
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 8000,
          maximumAge: 10 * 60 * 1000,
        });
      });
      return {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
      };
    } catch {
      return {};
    }
  };

  const handleDownload = async (shareAfterDownload = false) => {
    if (!logDate) {
      setMessage("请选择日期");
      setMessageType("error");
      return;
    }
    if (isAdmin && !selectedUserId) {
      setMessage("请先选择安全员");
      setMessageType("error");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const locationParams = await getCurrentPosition();
      const params = { log_date: logDate, ...locationParams };
      if (isAdmin) {
        params.user_id = selectedUserId;
      }
      const response = await api.get("/safety-logs/generate", {
        params,
        responseType: "blob",
      });
      const ownerName = isAdmin ? displayName(selectedInspector) : displayName(currentUser);
      const fileName = `施工安全日志-${ownerName}-${logDate}.docx`;
      const file = new File([response.data], fileName, {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      if (shareAfterDownload && navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({
          title: "施工安全日志",
          text: `施工安全日志 ${ownerName} ${logDate}`,
          files: [file],
        });
        setMessage(`施工安全日志 ${ownerName} ${logDate} 已生成并调起分享。`);
        setMessageType("success");
        await loadHistory();
        return;
      }

      const blobUrl = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
      setMessage(
        shareAfterDownload
          ? `当前浏览器不支持直接分享 Word 文件，已改为下载 ${ownerName} ${logDate} 的施工安全日志。`
          : `${ownerName} ${logDate} 的施工安全日志已生成并下载。`
      );
      setMessageType("success");
      await loadHistory();
    } catch (err) {
      const detail = err.response?.data
        ? await err.response.data.text?.().catch(() => "")
        : "";
      setMessage(detail || "安全日志生成失败，请检查日期、安全员或服务器。");
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-[linear-gradient(135deg,#f7fbff_0%,#f8fcfb_55%,#fff8f0_100%)] p-6 shadow-sm dark:border-border dark:bg-[linear-gradient(135deg,#26313c_0%,#273530_55%,#342f26_100%)]">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-100 dark:bg-blue-900/30">
            <FileText className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">施工安全日志</h1>
            <p className="mt-1.5 text-sm leading-6 text-slate-500">
              {isAdmin
                ? "选择安全员和巡查日期，生成该安全员当天的作业票据、隐患排查文字和照片。"
                : "选择巡查日期，自动汇总当天作业票据、隐患排查文字和照片，导出为 Word 文档。"}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid max-w-3xl gap-5 md:grid-cols-2">
          {isAdmin ? (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">
                <span className="flex items-center gap-2">
                  <UserRound className="h-4 w-4" />
                  安全员
                </span>
              </label>
              <select
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                value={selectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value)}
              >
                {inspectors.length ? (
                  inspectors.map((inspector) => (
                    <option key={inspector.id} value={inspector.id}>
                      {displayName(inspector)}
                    </option>
                  ))
                ) : (
                  <option value="">暂无安全员</option>
                )}
              </select>
            </div>
          ) : null}

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">
              <span className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4" />
                导出日期
              </span>
            </label>
            <input
              type="date"
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              value={logDate}
              onChange={(event) => setLogDate(event.target.value)}
              max={todayStr()}
            />
          </div>
        </div>

        <div className="mt-5 grid max-w-3xl gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => setLogDate(todayStr())}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-5 py-3.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RotateCcw className="h-4 w-4" />
            恢复当天日期
          </button>

          <button
            type="button"
            onClick={() => handleDownload(false)}
            disabled={loading || !logDate || (isAdmin && !selectedUserId)}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {loading ? "正在生成..." : "生成并下载"}
          </button>

          <button
            type="button"
            onClick={() => handleDownload(true)}
            disabled={loading || !logDate || (isAdmin && !selectedUserId)}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
            {loading ? "正在生成..." : "生成并分享"}
          </button>
        </div>

        {message ? (
          <div
            className={`mt-5 rounded-2xl px-4 py-3 text-sm ${
              messageType === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
            }`}
          >
            {message}
          </div>
        ) : null}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">安全日志历史</h2>
          <button
            type="button"
            onClick={loadHistory}
            disabled={historyLoading}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
          >
            {historyLoading ? "刷新中..." : "刷新"}
          </button>
        </div>

        {history.length ? (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
                <tr>
                  <th className="px-4 py-3">安全员</th>
                  <th className="px-4 py-3">日志日期</th>
                  <th className="px-4 py-3">导出人</th>
                  <th className="px-4 py-3">导出时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                {history.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-medium text-slate-900">{displayName(row.subject_user)}</td>
                    <td className="px-4 py-3">{row.log_date || "-"}</td>
                    <td className="px-4 py-3">{displayName(row.exported_by)}</td>
                    <td className="px-4 py-3">{formatDateTime(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
            {historyLoading ? "正在加载历史记录..." : "暂无安全日志导出记录"}
          </div>
        )}
      </section>
    </div>
  );
}
