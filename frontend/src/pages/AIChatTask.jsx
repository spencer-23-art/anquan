import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import api from "../lib/axios";
import { useAIChatStore } from "../stores/aiChatStore";

const PERMIT_LABELS = {
  confined_space: "受限空间作业票",
  height_level1: "一级高处作业票",
  height_level2: "二级高处作业票",
  height_level3: "三级高处作业票",
  height_special: "特级高处作业票",
  hot_work_level1: "一级动火作业票",
  hot_work_level2: "二级动火作业票",
  hot_work_level3: "普通动火作业票",
  lifting: "吊装作业票",
  excavation: "动土作业票",
  electrical: "临时用电作业票",
  other: "其他作业票",
};

const SEVERITY_LABELS = {
  high: "高风险",
  medium: "中风险",
  low: "低风险",
};

const SUGGESTIONS = [
  "地坑刷墙，深度约 5 米，坑内作业，2 人施工，准备使用脚手架，周边有车辆通行。",
  "厂房顶灯具更换，登高车作业，高度约 8 米，2 人施工，周边有人通行。",
  "污水池内部检修，2 人进入，现场潮湿，需要临时用电和气体检测。",
];

function stripThinkArtifacts(content) {
  const text = String(content || "").trim();
  if (!text) {
    return "";
  }

  const withoutThinkBlock = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (withoutThinkBlock.includes("</think>")) {
    return withoutThinkBlock.split("</think>").pop().trim();
  }
  return withoutThinkBlock;
}

function safeParseChecklist(content) {
  const cleaned = stripThinkArtifacts(content);
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function extractErrorMessage(err, fallback) {
  if (err?.code === "ECONNABORTED") {
    return "AI 响应超时了，请稍后再试一次。";
  }

  const detail = err?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail.trim();
  }
  if (Array.isArray(detail) && detail.length > 0) {
    return detail.map((item) => item?.msg || item?.message || JSON.stringify(item)).join("；");
  }
  if (detail && typeof detail === "object") {
    return detail.message || JSON.stringify(detail);
  }
  if (typeof err?.message === "string" && err.message.trim()) {
    return err.message.trim();
  }
  return fallback;
}

function normalizeText(text, fallback) {
  if (!text || !String(text).trim()) {
    return fallback;
  }

  return String(text).trim();
}

function formatHistoryTime(value) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function permitLabel(type) {
  return PERMIT_LABELS[type] || type || "未识别票证";
}

function permitReason(permit) {
  return permit?.reason?.trim() || `必须办理 ${permitLabel(permit?.type)}`;
}

function permitExistingMatch(permit) {
  return permit?.existing_permit_match || null;
}

function permitWorkDescription({ permit, title, areaName }) {
  if (permit?.description?.trim()) {
    return permit.description.trim();
  }
  const label = permitLabel(permit?.type)
    .replace("作业票", "作业")
    .replace("票证", "")
    .replace("票", "");
  return [areaName, title, label].filter(Boolean).join("");
}

function severityTone(severity) {
  switch (severity) {
    case "high":
      return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
    case "low":
      return "bg-sky-50 text-sky-700 ring-1 ring-sky-200";
    default:
      return "bg-amber-50 text-amber-800 ring-1 ring-amber-200";
  }
}

function splitGuidanceSections(item) {
  const raw = String(item?.measure || "");
  const parsed = {
    inspection:
      String(item?.inspection_points || "").trim() ||
      (raw.match(/排查要点[:：]\s*([\s\S]*?)(?=\n拍照要求[:：]|\n整改要求[:：]|$)/)?.[1]?.trim() || ""),
    photo:
      String(item?.photo_requirements || "").trim() ||
      (raw.match(/拍照要求[:：]\s*([\s\S]*?)(?=\n整改要求[:：]|$)/)?.[1]?.trim() || ""),
    rectification:
      raw.match(/整改要求[:：]\s*([\s\S]*)$/)?.[1]?.trim() || "",
  };

  if (!parsed.inspection && !parsed.photo && !parsed.rectification) {
    parsed.rectification = raw.trim();
  }

  return parsed;
}

function SelectDot({ selected, tone = "emerald" }) {
  const classes =
    tone === "amber"
      ? selected
        ? "border-amber-500 bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.14)]"
        : "border-slate-300 bg-white"
      : selected
        ? "border-emerald-500 bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]"
        : "border-slate-300 bg-white";

  return <span className={`mt-1 h-4 w-4 shrink-0 rounded-full border transition ${classes}`} />;
}

export default function AIChatTask() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [areas, setAreas] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [configInfo, setConfigInfo] = useState(null);
  const [pageMessage, setPageMessage] = useState("");
  const [analysisHistory, setAnalysisHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [deletingHistoryId, setDeletingHistoryId] = useState(null);
  const [selectedRiskIndexes, setSelectedRiskIndexes] = useState([]);
  const [selectedPermitIndexes, setSelectedPermitIndexes] = useState([]);
  const [createForm, setCreateForm] = useState({
    area_id: "",
    assignee_id: "",
  });
  const chatViewportRef = useRef(null);

  const { messages, draftTask, appendMessage, setDraftTask, reset } = useAIChatStore();

  const loadHistory = useCallback(async (areaId) => {
    setHistoryLoading(true);
    try {
      const params = { limit: 200 };
      if (areaId) {
        params.area_id = Number(areaId);
      }
      const { data } = await api.get("/ai/history", { params });
      setAnalysisHistory(data || []);
    } catch (err) {
      setPageMessage(extractErrorMessage(err, "分析历史加载失败，请稍后重试。"));
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPageData() {
      setOptionsLoading(true);
      try {
        const [areasResponse, usersResponse, configResponse] = await Promise.all([
          api.get("/areas"),
          api.get("/users", { params: { status_filter: "approved" } }),
          api.get("/ai/runtime-config"),
        ]);

        if (cancelled) {
          return;
        }

        const areaList = areasResponse.data || [];
        const assigneeList = usersResponse.data || [];
        const runtime = configResponse.data || null;

        setAreas(areaList);
        setAssignees(assigneeList);
        setConfigInfo(runtime);
        setCreateForm((current) => ({
          area_id: current.area_id || String(areaList[0]?.id || ""),
          assignee_id: current.assignee_id || String(assigneeList[0]?.id || ""),
        }));
      } catch (err) {
        if (!cancelled) {
          setPageMessage(extractErrorMessage(err, "AI 页面初始化失败，请刷新后重试。"));
        }
      } finally {
        if (!cancelled) {
          setOptionsLoading(false);
        }
      }
    }

    loadPageData();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!chatViewportRef.current) {
      return;
    }
    chatViewportRef.current.scrollTo({
      top: chatViewportRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  useEffect(() => {
    if (optionsLoading) {
      return;
    }
    loadHistory(createForm.area_id);
  }, [createForm.area_id, loadHistory, optionsLoading]);

  useEffect(() => {
    if (!draftTask?.items?.length) {
      setSelectedRiskIndexes([]);
    } else {
      setSelectedRiskIndexes(draftTask.items.map((_, index) => index));
    }

    if (!draftTask?.permits?.length) {
      setSelectedPermitIndexes([]);
    } else {
      setSelectedPermitIndexes(
        draftTask.permits
          .map((permit, index) => (permit?.covered_by_existing_permit ? null : index))
          .filter((index) => index !== null),
      );
    }
  }, [draftTask]);

  const selectedArea = useMemo(
    () => areas.find((area) => String(area.id) === String(createForm.area_id)),
    [areas, createForm.area_id]
  );

  const selectedAssignee = useMemo(
    () => assignees.find((assignee) => String(assignee.id) === String(createForm.assignee_id)),
    [assignees, createForm.assignee_id]
  );

  const selectedRiskItems = useMemo(() => {
    if (!draftTask?.items?.length) {
      return [];
    }
    return draftTask.items.filter((_, index) => selectedRiskIndexes.includes(index));
  }, [draftTask, selectedRiskIndexes]);

  const selectedPermits = useMemo(() => {
    if (!draftTask?.permits?.length) {
      return [];
    }
    return draftTask.permits.filter((_, index) => selectedPermitIndexes.includes(index));
  }, [draftTask, selectedPermitIndexes]);

  const togglePermitSelection = useCallback((index) => {
    setSelectedPermitIndexes((current) =>
      current.includes(index)
        ? current.filter((item) => item !== index)
        : [...current, index].sort((a, b) => a - b),
    );
  }, []);

  const enrichPermits = useCallback(
    (permits, title) =>
      (permits || []).map((permit) => ({
        ...permit,
        description: permitWorkDescription({
          permit,
          title,
          areaName: selectedArea?.name,
        }),
      })),
    [selectedArea?.name]
  );

  const buildDraftFromHistory = (history) => {
    const payload = history?.payload || {};
    const title = normalizeText(payload.summary || history.title, "AI 历史分析任务");
    return {
      session_id: history.session_id,
      title,
      items: (payload.items || []).map((item) => ({
        ...item,
        risk_description: normalizeText(item.risk_description, "待确认风险"),
        inspection_points: normalizeText(item.inspection_points, ""),
        photo_requirements: normalizeText(item.photo_requirements, ""),
        measure: normalizeText(item.measure, ""),
      })),
      permits: enrichPermits(payload.permits || [], title),
      suppressed_permits: payload.suppressed_permits || [],
    };
  };

  const applyHistory = (history) => {
    const nextDraft = buildDraftFromHistory(history);
    setDraftTask(nextDraft);
    setSessionId(history.session_id);
    if (history.area_id) {
      setCreateForm((current) => ({ ...current, area_id: String(history.area_id) }));
    }
    setPageMessage("已从历史记录恢复分析结果，可直接重新下发。负责人由安全员在客户端拍作业票据时填写。");
  };

  const dispatchHistory = async (history) => {
    const nextDraft = buildDraftFromHistory(history);
    const areaId = history.area_id || createForm.area_id;
    if (!areaId || !createForm.assignee_id) {
      setPageMessage("请先选择所属区域和负责人，再从历史记录重新下发。");
      return;
    }
    if (!nextDraft.items.length) {
      setPageMessage("这条历史记录没有可下发的隐患检查项。");
      return;
    }
    setLoading(true);
    setPageMessage("");
    try {
      const { data } = await api.post("/ai/create-task", {
        session_id: nextDraft.session_id,
        title: nextDraft.title,
        items: nextDraft.items,
        permits: nextDraft.permits,
        area_id: Number(areaId),
        assignee_id: Number(createForm.assignee_id),
      }, { timeout: 180000 });
      const issuedPermitCount = data?.permit_count ?? nextDraft.permits.length;
      const suppressedPermitCount = data?.suppressed_permit_count ?? 0;
      appendMessage({
        role: "assistant",
        content: `已根据历史记录重新下发 ${nextDraft.items.length} 条隐患检查项，并生成 ${issuedPermitCount} 张需办理票证。${
          suppressedPermitCount
            ? ` 已和作业许可核对，${suppressedPermitCount} 张同类型票证剩余有效期超过 20%，本次不重复下发。`
            : ""
        }`,
      });
      setPageMessage(
        suppressedPermitCount
          ? `历史记录已重新下发，已过滤 ${suppressedPermitCount} 张仍有效的作业许可，不需要重复办票。`
          : "历史记录已重新下发。现场检查时请按排查要点逐项核查并上传佐证照片。"
      );
      await loadHistory(areaId);
    } catch (err) {
      setPageMessage(extractErrorMessage(err, "历史记录重新下发失败，请检查区域和负责人后重试。"));
    } finally {
      setLoading(false);
    }
  };

  const deleteHistory = async (history) => {
    if (!window.confirm("确定删除这条 AI 分析历史吗？删除后不会影响已经下发的任务。")) {
      return;
    }

    setDeletingHistoryId(history.id);
    setPageMessage("");
    try {
      await api.delete(`/ai/history/${history.id}`);
      setAnalysisHistory((current) => current.filter((item) => item.id !== history.id));
      setPageMessage("分析历史已删除。");
    } catch (err) {
      setPageMessage(extractErrorMessage(err, "分析历史删除失败，请稍后重试。"));
    } finally {
      setDeletingHistoryId(null);
    }
  };

  const leftPanelStyle = draftTask ? { flex: 0.92, minWidth: 0 } : { flex: 1.12, minWidth: 0 };
  const rightPanelStyle = draftTask ? { flex: 1.08, minWidth: 0 } : { flex: 0.88, minWidth: 0 };

  const sendMessage = async () => {
    if (!input.trim() || loading) {
      return;
    }

    const userMessage = { role: "user", content: input.trim() };
    appendMessage(userMessage);
    setInput("");
    setLoading(true);
    setPageMessage("");

    try {
      const { data } = await api.post("/ai/chat", {
        session_id: sessionId,
        message: userMessage.content,
        area_id: createForm.area_id ? Number(createForm.area_id) : undefined,
      }, { timeout: 180000 });

      setSessionId(data.session_id);

      const parsed = safeParseChecklist(data.content);
      const displayContent =
        parsed?.type === "checklist"
          ? `风险识别完成，已生成 ${parsed.items?.length || 0} 条隐患检查项和 ${parsed.permits?.length || 0} 张必须办理票证。${
              parsed.suppressed_permits?.length
                ? ` 同区域已有 ${parsed.suppressed_permits.length} 张有效票证，剩余有效期超过 20%，已自动不再重复提醒。`
                : ""
            }`
          : parsed?.content || stripThinkArtifacts(data.content);

      appendMessage({
        role: "assistant",
        content: normalizeText(displayContent, "AI 已返回分析结果。"),
      });

      if (parsed?.type === "checklist") {
        setDraftTask({
          session_id: data.session_id,
          title: normalizeText(parsed.summary, "AI 生成作业任务"),
          items: (parsed.items || []).map((item) => ({
            ...item,
            risk_description: normalizeText(item.risk_description, "待确认风险"),
            inspection_points: normalizeText(item.inspection_points, ""),
            photo_requirements: normalizeText(item.photo_requirements, ""),
            measure: normalizeText(item.measure, ""),
          })),
          permits: enrichPermits(parsed.permits || [], normalizeText(parsed.summary, "AI 生成作业任务")),
          suppressed_permits: parsed.suppressed_permits || [],
        });
        await loadHistory(createForm.area_id);
      }
    } catch (err) {
      appendMessage({
        role: "assistant",
        content: extractErrorMessage(err, "AI 服务暂时不可用，请稍后再试。"),
      });
    } finally {
      setLoading(false);
    }
  };

  const createTask = async () => {
    if (!draftTask) {
      setPageMessage("请先让 AI 完成一次风险分析。");
      return;
    }
    if (!selectedRiskItems.length) {
      setPageMessage("请至少选择一条需要下发的隐患检查项。");
      return;
    }
    if (!createForm.area_id || !createForm.assignee_id) {
      setPageMessage("请先选择所属区域和负责人。");
      return;
    }
    setLoading(true);
    setPageMessage("");

    try {
      const { data } = await api.post("/ai/create-task", {
        session_id: draftTask.session_id,
        title: draftTask.title,
        items: selectedRiskItems,
        permits: selectedPermits,
        area_id: Number(createForm.area_id),
        assignee_id: Number(createForm.assignee_id),
      }, { timeout: 180000 });
      const issuedPermitCount = data?.permit_count ?? selectedPermits.length;
      const suppressedPermitCount = data?.suppressed_permit_count ?? 0;

      appendMessage({
        role: "assistant",
        content: `任务创建成功，已下发 ${selectedRiskItems.length} 条隐患检查项，并生成 ${issuedPermitCount} 张必须办理票证。${
          suppressedPermitCount
            ? ` 已自动过滤 ${suppressedPermitCount} 张剩余有效期超过 20% 的同区域同类型作业许可。`
            : ""
        }`,
      });
      setPageMessage(
        suppressedPermitCount
          ? `任务已成功创建。${suppressedPermitCount} 张票证仍在有效期内，本次不重复办票。`
          : "任务已成功创建。现场检查时请按排查要点逐项核查，并按拍照要求上传佐证照片。"
      );
      setDraftTask(null);
    } catch (err) {
      setPageMessage(extractErrorMessage(err, "任务创建失败，请补充信息后重试。"));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    reset();
    setSessionId(null);
    setPageMessage("");
    setInput("");
    setSelectedRiskIndexes([]);
    setSelectedPermitIndexes([]);
  };

  const handleTextareaKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="ai-risk-page space-y-4 sm:space-y-6">
      <section className="rounded-[24px] border border-emerald-100 bg-[linear-gradient(135deg,#f4fbf7_0%,#ecf7ff_58%,#fff8ee_100%)] px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.06)] dark:border-border dark:bg-[linear-gradient(135deg,#27312f_0%,#26313a_58%,#332f27_100%)] sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex w-fit items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium tracking-wide text-emerald-700">
            <Sparkles size={14} />
            AI 风险分析
          </div>

          <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-2 text-sm shadow-sm backdrop-blur">
            <span className="text-slate-500">接口状态：</span>
            <span className="font-medium text-emerald-700">{configInfo?.ai_base_url ? "已连接" : "待配置"}</span>
          </div>
        </div>
      </section>

      {pageMessage ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {pageMessage}
        </div>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        <section
          style={leftPanelStyle}
          className={`rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_10px_35px_rgba(15,23,42,0.06)] transition-all duration-500 sm:p-6 ${
            draftTask ? "lg:-translate-x-1 lg:scale-[0.99]" : ""
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-slate-900">
                <Bot size={18} />
                <h2 className="text-lg font-semibold">对话分析区</h2>
              </div>
              <p className="mt-2 text-sm text-slate-500">按回车直接发送，按 Shift + Enter 换行。</p>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
            >
              清空本轮
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setInput(suggestion)}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
              >
                {suggestion}
              </button>
            ))}
          </div>

          <div
            ref={chatViewportRef}
            className={`mt-5 space-y-3 overflow-y-auto rounded-3xl bg-slate-50 p-4 transition-all duration-500 ${
              draftTask ? "h-[520px] sm:h-[560px]" : "h-[420px] sm:h-[460px]"
            }`}
          >
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white px-6 text-center">
                <Sparkles className="h-10 w-10 text-emerald-500" />
                <div className="mt-4 text-base font-medium text-slate-900">先描述一个作业场景</div>
                <div className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  比如“地坑刷墙，深度约 5 米，坑内脚手架作业，2 人施工，周边有车辆通行，需要拍照核查脚手架和安全带。”
                </div>
              </div>
            ) : null}

            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`whitespace-pre-line rounded-3xl px-4 py-3 text-sm leading-6 ${
                  message.role === "user"
                    ? "ml-6 border border-emerald-100 bg-emerald-100 text-emerald-950 sm:ml-10"
                    : "mr-6 border border-slate-200 bg-white text-slate-700 shadow-sm sm:mr-10"
                }`}
              >
                {message.content}
              </div>
            ))}

            {loading ? (
              <div className="mr-6 inline-flex items-center gap-2 rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm sm:mr-10">
                <Loader2 className="h-4 w-4 animate-spin" />
                AI 正在分析现场风险...
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <textarea
              className="min-h-28 flex-1 rounded-3xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleTextareaKeyDown}
              placeholder="输入作业描述，例如：地坑刷墙，深度 5 米，坑内脚手架作业，2 人施工，需要检查脚手架稳定和安全带佩戴。"
            />
            <button
              type="button"
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="rounded-3xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              发送分析
            </button>
          </div>

          <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-slate-900">
                <Clock3 size={18} className="text-emerald-600" />
                <h2 className="text-base font-semibold">分析历史</h2>
              </div>
              <button
                type="button"
                onClick={() => loadHistory(createForm.area_id)}
                disabled={historyLoading}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
              >
                <RotateCcw size={15} className={historyLoading ? "animate-spin" : ""} />
                刷新
              </button>
            </div>

            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              {analysisHistory.length ? (
                analysisHistory.map((history) => (
                  <div key={history.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{history.title}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {history.area_name || "未绑定区域"} · {formatHistoryTime(history.created_at)}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full bg-slate-50 px-2 py-1 text-xs text-slate-600">
                        {history.item_count} 项
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-600">
                      <span>需办票证 {history.permit_count} 张</span>
                      {history.payload?.suppressed_permits?.length ? (
                        <span className="text-emerald-700">已过滤有效票证 {history.payload.suppressed_permits.length} 张</span>
                      ) : null}
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => applyHistory(history)}
                        className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                      >
                        载入草稿
                      </button>
                      <button
                        type="button"
                        onClick={() => dispatchHistory(history)}
                        disabled={loading}
                        className="rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
                      >
                        重新下发
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteHistory(history)}
                        disabled={deletingHistoryId === history.id}
                        className="inline-flex items-center justify-center gap-1 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingHistoryId === history.id ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Trash2 size={13} />
                        )}
                        删除
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-5 text-sm text-slate-500 xl:col-span-2">
                  {historyLoading ? "正在加载历史记录..." : "当前区域暂无分析历史。完成一次 AI 分析后，这里会自动保存。"}
                </div>
              )}
            </div>
          </div>
        </section>

        <aside
          style={rightPanelStyle}
          className={`rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_10px_35px_rgba(15,23,42,0.06)] transition-all duration-500 sm:p-6 ${
            draftTask ? "lg:-translate-x-3 ring-1 ring-emerald-100" : "lg:scale-[0.985]"
          }`}
        >
          <div className="flex items-center gap-2 text-slate-900">
            <CheckCircle2 size={18} />
            <h2 className="text-lg font-semibold">任务草稿</h2>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            票证在最上方。选中的票证代表必须办理并拍照上传。隐患卡片里会直接显示排查要点、拍照要求和整改要求。
          </p>

          {draftTask ? (
            <div className="mt-5 space-y-5 text-sm text-slate-700">
              <div className="rounded-3xl bg-[linear-gradient(135deg,#f7fafc_0%,#eefcf6_100%)] p-4 dark:bg-[linear-gradient(135deg,#26303a_0%,#263832_100%)]">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">草稿标题</div>
                <div className="mt-2 text-base font-semibold text-slate-900">{draftTask.title}</div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-3xl bg-amber-50 px-4 py-3">
                  <div className="text-xs text-amber-700">必办票证</div>
                  <div className="mt-1 text-xl font-semibold text-amber-900">{selectedPermits.length}</div>
                </div>
                <div className="rounded-3xl bg-emerald-50 px-4 py-3">
                  <div className="text-xs text-emerald-700">下发隐患</div>
                  <div className="mt-1 text-xl font-semibold text-emerald-900">{selectedRiskItems.length}</div>
                </div>
                <div className="rounded-3xl bg-slate-50 px-4 py-3">
                  <div className="text-xs text-slate-500">识别总数</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">{draftTask.items?.length || 0}</div>
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 font-medium text-slate-900">
                    <ShieldCheck size={16} className="text-amber-500" />
                    必须办理票证
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedPermitIndexes(draftTask.permits.map((_, index) => index))}
                      className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700 transition hover:bg-amber-100"
                    >
                      全选
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedPermitIndexes([])}
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 transition hover:bg-slate-100"
                    >
                      清空
                    </button>
                  </div>
                </div>

                {draftTask.permits?.length ? (
                  <div className="space-y-3">
                    {draftTask.permits.map((permit, index) => {
                      const selected = selectedPermitIndexes.includes(index);
                      const existingMatch = permitExistingMatch(permit);
                      return (
                        <div
                          key={`${permit.type}-${index}`}
                          onClick={() => togglePermitSelection(index)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              togglePermitSelection(index);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          className={`w-full rounded-3xl border px-4 py-4 text-left transition ${
                            selected ? "border-amber-300 bg-amber-50 shadow-sm" : "border-slate-200 bg-white"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                togglePermitSelection(index);
                              }}
                              className="shrink-0"
                              title={selected ? "取消下发该票证" : "选择下发该票证"}
                            >
                              <SelectDot selected={selected} tone="amber" />
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div className="font-medium text-slate-900">{permitLabel(permit.type)}</div>
                                <div className="flex items-center gap-2">
                                  <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                                    必须办票
                                  </span>
                                  {existingMatch ? (
                                    <span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-medium text-sky-800">
                                      许可池已有
                                    </span>
                                  ) : null}
                                  {selected ? (
                                    <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800">
                                      已选中
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              <div className="mt-2 text-xs leading-5 text-slate-700">{permitReason(permit)}</div>
                              {existingMatch ? (
                                <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-900">
                                  许可池已匹配：{permitLabel(existingMatch.existing_type)}
                                  {existingMatch.remaining_percent !== undefined
                                    ? `，剩余有效期 ${existingMatch.remaining_percent}%`
                                    : ""}
                                  。本次默认不重复下发，需要重复办理时可手动选中。
                                </div>
                              ) : null}
                              {permit.description ? (
                                <div className="mt-3 rounded-2xl border border-amber-200 bg-white/90 px-3 py-2 text-xs leading-5 text-slate-700">
                                  作业许可描述：{permit.description}
                                </div>
                              ) : null}
                              <div className="mt-3 rounded-2xl border border-amber-200 bg-white/90 px-3 py-2 text-xs leading-5 text-amber-900">
                                票证类型和级别由 AI 风险识别确定，不可在下发时改变；负责人由安全员在客户端拍作业票据时填写。
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-3xl border border-slate-200 bg-slate-50 px-3 py-3 text-slate-500">
                    当前草稿没有识别出必须办理的票证。
                  </div>
                )}

                {draftTask.suppressed_permits?.length ? (
                  <div className="mt-3 rounded-3xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-800">
                    同区域已有 {draftTask.suppressed_permits.length} 张同类型作业许可仍在有效期内，且剩余有效期超过 20%，本次已自动不再重复生成。
                  </div>
                ) : null}
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 font-medium text-slate-900">
                    <AlertTriangle size={16} className="text-emerald-500" />
                    隐患检查项
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedRiskIndexes(draftTask.items.map((_, index) => index))}
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700 transition hover:bg-emerald-100"
                    >
                      全选
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedRiskIndexes([])}
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 transition hover:bg-slate-100"
                    >
                      清空
                    </button>
                  </div>
                </div>

                <div className="max-h-[460px] space-y-3 overflow-y-auto pr-1">
                  {(draftTask.items || []).map((item, index) => {
                    const selected = selectedRiskIndexes.includes(index);
                    const guidance = splitGuidanceSections(item);

                    return (
                      <button
                        key={`${item.risk_description}-${index}`}
                        type="button"
                        onClick={() =>
                          setSelectedRiskIndexes((current) =>
                            current.includes(index)
                              ? current.filter((itemIndex) => itemIndex !== index)
                              : [...current, index].sort((a, b) => a - b)
                          )
                        }
                        className={`w-full rounded-3xl border px-4 py-4 text-left transition ${
                          selected ? "border-emerald-200 bg-emerald-50/70 shadow-sm" : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <SelectDot selected={selected} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="text-xs font-medium text-slate-500">隐患 {index + 1}</div>
                              <span className={`rounded-full px-2 py-1 text-xs font-medium ${severityTone(item.severity)}`}>
                                {SEVERITY_LABELS[item.severity] || "中风险"}
                              </span>
                            </div>

                            <div className="mt-2 text-sm leading-6 text-slate-900">
                              {normalizeText(item.risk_description, "待确认隐患")}
                            </div>

                            {guidance.inspection ? (
                              <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50/80 px-3 py-2 text-xs leading-5 text-sky-900">
                                <div className="font-semibold text-sky-800">怎么排查</div>
                                <div className="mt-1">{normalizeText(guidance.inspection, "请现场补充排查要点")}</div>
                              </div>
                            ) : null}

                            {guidance.photo ? (
                              <div className="mt-3 rounded-2xl border border-violet-200 bg-violet-50/80 px-3 py-2 text-xs leading-5 text-violet-900">
                                <div className="font-semibold text-violet-800">拍照要求</div>
                                <div className="mt-1">{normalizeText(guidance.photo, "请补充拍照要求")}</div>
                              </div>
                            ) : null}

                            {guidance.rectification ? (
                              <div className="mt-3 rounded-2xl bg-white/80 px-3 py-2 text-xs leading-5 text-slate-700">
                                <div className="font-semibold text-slate-800">整改要求</div>
                                <div className="mt-1">{normalizeText(guidance.rectification, "请补充整改要求")}</div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">下发汇总</div>
                <div className="mt-2 text-sm leading-6 text-slate-800">
                  将下发 <span className="font-semibold text-emerald-700">{selectedRiskItems.length}</span> 条隐患检查项，
                  必须办理 <span className="font-semibold text-amber-700">{selectedPermits.length}</span> 张票证。
                </div>
              </div>

              <div className="grid gap-4">
                <div>
                  <label className="mb-2 block font-medium text-slate-900">所属区域</label>
                  <select
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                    value={createForm.area_id}
                    onChange={(event) => setCreateForm({ ...createForm, area_id: event.target.value })}
                    disabled={optionsLoading}
                  >
                    <option value="">{optionsLoading ? "区域加载中..." : "请选择区域"}</option>
                    {areas.map((area) => (
                      <option key={area.id} value={area.id}>
                        {area.name}
                      </option>
                    ))}
                  </select>
                  {selectedArea ? <div className="mt-2 text-xs text-slate-500">已选择：{selectedArea.name}</div> : null}
                </div>

                <div>
                  <label className="mb-2 block font-medium text-slate-900">指派负责人</label>
                  <select
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                    value={createForm.assignee_id}
                    onChange={(event) => setCreateForm({ ...createForm, assignee_id: event.target.value })}
                    disabled={optionsLoading}
                  >
                    <option value="">{optionsLoading ? "负责人加载中..." : "请选择负责人"}</option>
                    {assignees.map((assignee) => (
                      <option key={assignee.id} value={assignee.id}>
                        {assignee.real_name} ({assignee.username})
                      </option>
                    ))}
                  </select>
                  {selectedAssignee ? (
                    <div className="mt-2 text-xs text-slate-500">已选择：{selectedAssignee.real_name}</div>
                  ) : null}
                </div>
              </div>

              <button
                type="button"
                onClick={createTask}
                disabled={loading}
                className="w-full rounded-3xl bg-emerald-600 px-4 py-3 font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
              >
                一键创建任务并下发所选内容
              </button>
            </div>
          ) : (
            <div className="mt-5 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center">
              <div className="text-base font-medium text-slate-900">暂无任务草稿</div>
              <div className="mt-2 text-sm leading-6 text-slate-500">
                完成一轮 AI 分析后，这里会自动生成隐患检查项、排查要点、拍照要求和任务创建入口。
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
