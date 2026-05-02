import { useState } from "react";
import { CalendarDays, Download, FileText, Loader2, RotateCcw, Share2 } from "lucide-react";
import api from "../lib/axios";

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

export default function SafetyLog() {
  const [logDate, setLogDate] = useState(todayStr());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("success");

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
    setLoading(true);
    setMessage("");
    try {
      const locationParams = await getCurrentPosition();
      const response = await api.get("/safety-logs/generate", {
        params: { log_date: logDate, ...locationParams },
        responseType: "blob",
      });
      const fileName = `施工安全日志-${logDate}.docx`;
      const file = new File([response.data], fileName, {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      if (shareAfterDownload && navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({
          title: "施工安全日志",
          text: `施工安全日志 ${logDate}`,
          files: [file],
        });
        setMessage(`施工安全日志 ${logDate} 已生成并调起分享。`);
        setMessageType("success");
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
          ? `当前浏览器不支持直接分享 Word 文件，已改为下载施工安全日志 ${logDate}。`
          : `施工安全日志 ${logDate} 已生成并下载。`
      );
      setMessageType("success");
    } catch (err) {
      const detail = err.response?.data
        ? await err.response.data.text?.().catch(() => "")
        : "";
      setMessage(detail || "安全日志生成失败，请检查日期或服务器。");
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
              选择巡查日期，自动汇总当天作业票据、隐患排查文字和照片，导出为 Word 文档。
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="max-w-md space-y-5">
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
              onChange={(e) => setLogDate(e.target.value)}
              max={todayStr()}
            />
            <p className="text-xs text-slate-400">
              日志将汇总所选日期当天您参与的隐患排查和作业票据。
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
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
              disabled={loading || !logDate}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {loading ? "正在生成..." : "生成并下载"}
            </button>
          </div>

          <button
            type="button"
            onClick={() => handleDownload(true)}
            disabled={loading || !logDate}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
            {loading ? "正在生成..." : "生成并分享"}
          </button>

          {message ? (
            <div
              className={`rounded-2xl px-4 py-3 text-sm ${
                messageType === "error"
                  ? "bg-rose-50 text-rose-700"
                  : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {message}
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">日志包含内容</h2>
        <ul className="space-y-2 text-sm text-slate-500">
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
            当日天气（自动获取）
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
            当日已办理的作业许可票证及照片
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
            当日隐患排查清单（风险描述、排查要点、整改要求、现场照片）
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
            导出格式：Word(.docx)，可直接打印或归档
          </li>
        </ul>
      </section>
    </div>
  );
}
