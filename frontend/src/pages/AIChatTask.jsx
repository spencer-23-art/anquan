import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Loader2,
  ShieldCheck,
  Sparkles,
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
  hot_work_level3: "三级动火作业票",
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
  "厂房夹层拆旧设备，需要动火并搭设脚手架，3人施工。",
  "污水池内部检修，2人进入受限空间，现场潮湿，需要临时用电。",
  "仓库外立面高处清洗，使用登高车作业，高度约8米，周边有通行人员。",
];

function safeParseChecklist(content) {
  try {
    return JSON.parse(content);
  } catch {
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
    return detail
      .map((item) => item?.msg || item?.message || JSON.stringify(item))
      .join("；");
  }

  if (detail && typeof detail === "object") {
    return detail.message || JSON.stringify(detail);
  }

  if (typeof err?.message === "string" && err.message.trim()) {
    return err.message.trim();
  }

  return fallback;
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

function permitLabel(type) {
  return PERMIT_LABELS[type] || type || "未识别票种";
}

function permitReason(permit) {
  return permit?.reason?.trim() || `必须同步办理 ${permitLabel(permit?.type)}`;
}

function normalizeText(text, fallback) {
  if (!text || !String(text).trim()) {
    return fallback;
  }

  return String(text)
    .trim()
    .replace(/Generated from AI session/gi, "AI 会话生成")
    .replace(/risk/gi, "风险")
    .replace(/measure/gi, "措施");
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
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [pageMessage, setPageMessage] = useState("");
  const [selectedRiskIndexes, setSelectedRiskIndexes] = useState([]);
  const [selectedPermitIndexes, setSelectedPermitIndexes] = useState([]);
  const [createForm, setCreateForm] = useState({
    area_id: "",
    assignee_id: "",
  });
  const chatViewportRef = useRef(null);

  const { messages, draftTask, appendMessage, setDraftTask, reset } = useAIChatStore();

  useEffect(() => {
    let cancelled = false;

    const loadPageData = async () => {
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
        setAreas(areaList);
        setAssignees(assigneeList);
        setConfigInfo(configResponse.data || null);
        setSelectedProviderId(
          configResponse.data?.active_provider_id ||
            configResponse.data?.providers?.[0]?.id ||
            ""
        );
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
    };

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
    if (!draftTask?.items?.length) {
      setSelectedRiskIndexes([]);
    } else {
      setSelectedRiskIndexes(draftTask.items.map((_, index) => index));
    }

    if (!draftTask?.permits?.length) {
      setSelectedPermitIndexes([]);
    } else {
      setSelectedPermitIndexes(draftTask.permits.map((_, index) => index));
    }
  }, [draftTask]);

  const selectedArea = useMemo(
    () => areas.find((area) => String(area.id) === String(createForm.area_id)),
    [areas, createForm.area_id]
  );

  const selectedAssignee = useMemo(
    () =>
      assignees.find(
        (assignee) => String(assignee.id) === String(createForm.assignee_id)
      ),
    [assignees, createForm.assignee_id]
  );

  const selectedProvider = useMemo(() => {
    const providers = configInfo?.providers || [];
    return (
      providers.find((provider) => provider.id === selectedProviderId) ||
      providers[0] ||
      null
    );
  }, [configInfo, selectedProviderId]);

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

  const leftPanelStyle = draftTask
    ? { flex: 0.86, minWidth: 0 }
    : { flex: 1.16, minWidth: 0 };

  const rightPanelStyle = draftTask
    ? { flex: 1.14, minWidth: 0 }
    : { flex: 0.84, minWidth: 0 };

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
        provider_id: selectedProviderId || undefined,
      });
      setSessionId(data.session_id);

      const parsed = safeParseChecklist(data.content);
      const displayContent =
        parsed?.type === "checklist"
          ? `风险识别完成，已生成 ${parsed.items?.length || 0} 条风险和 ${parsed.permits?.length || 0} 张必须办理票证。`
          : parsed?.content || data.content;

      appendMessage({
        role: "assistant",
        content: normalizeText(displayContent, "AI 已返回分析结果。"),
      });

      if (parsed?.type === "checklist") {
        const uniquePermits = [];
        const seenPermitTypes = new Set();

        for (const permit of parsed.permits || []) {
          if (!permit?.type || seenPermitTypes.has(permit.type)) {
            continue;
          }
          seenPermitTypes.add(permit.type);
          uniquePermits.push(permit);
        }

        setDraftTask({
          session_id: data.session_id,
          title: normalizeText(parsed.summary, "AI 生成作业草稿"),
          items: (parsed.items || []).map((item) => ({
            ...item,
            risk_description: normalizeText(item.risk_description, "待确认风险"),
            measure: normalizeText(item.measure, ""),
          })),
          permits: uniquePermits,
        });
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

  const toggleRisk = (index) => {
    setSelectedRiskIndexes((current) =>
      current.includes(index)
        ? current.filter((item) => item !== index)
        : [...current, index].sort((a, b) => a - b)
    );
  };

  const togglePermit = (index) => {
    setSelectedPermitIndexes((current) =>
      current.includes(index)
        ? current.filter((item) => item !== index)
        : [...current, index].sort((a, b) => a - b)
    );
  };

  const selectAllRisks = () => {
    if (draftTask?.items?.length) {
      setSelectedRiskIndexes(draftTask.items.map((_, index) => index));
    }
  };

  const clearRiskSelection = () => {
    setSelectedRiskIndexes([]);
  };

  const selectAllPermits = () => {
    if (draftTask?.permits?.length) {
      setSelectedPermitIndexes(draftTask.permits.map((_, index) => index));
    }
  };

  const clearPermitSelection = () => {
    setSelectedPermitIndexes([]);
  };

  const createTask = async () => {
    if (!draftTask) {
      setPageMessage("请先让 AI 完成一次风险分析。");
      return;
    }

    if (!selectedRiskItems.length) {
      setPageMessage("请至少选择一条需要下发的风险。");
      return;
    }

    if (!selectedPermits.length) {
      setPageMessage("请至少选择一张必须办理的票证。");
      return;
    }

    if (!createForm.area_id || !createForm.assignee_id) {
      setPageMessage("请先选择区域和负责人。");
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
      });

      appendMessage({
        role: "assistant",
        content: `任务创建成功，已下发 ${selectedRiskItems.length} 条风险，并生成 ${selectedPermits.length} 张必须办理票证。`,
      });
      setPageMessage("任务已成功创建。已选票证必须办理，并由现场拍照上传后才算完成闭环。");
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
    <div className="space-y-6">
      <section className="rounded-[28px] border border-emerald-100 bg-[linear-gradient(135deg,#f4fbf7_0%,#ecf7ff_52%,#fff8ee_100%)] p-6 shadow-[0_10px_35px_rgba(15,23,42,0.08)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium tracking-wide text-emerald-700">
              <Sparkles size={14} />
              AI 风险分析
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">
              从作业描述直接生成风险草稿
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              输入现场作业场景，AI 会先补齐必要信息，再输出风险清单、必须办理票证和任务草稿。
              草稿出来后，右侧会扩展，左侧会收窄，但始终保持左右并排。
            </p>
          </div>

          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3 shadow-sm backdrop-blur">
              <div className="text-slate-500">当前模型</div>
              <div className="mt-1 font-medium text-slate-900">
                {configInfo?.ai_model || "未配置"}
              </div>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3 shadow-sm backdrop-blur">
              <div className="text-slate-500">接口状态</div>
              <div className="mt-1 font-medium text-emerald-700">
                {configInfo?.ai_base_url ? "已连接" : "待配置"}
              </div>
            </div>
          </div>
        </div>
      </section>

      {pageMessage ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {pageMessage}
        </div>
      ) : null}

      {(configInfo?.providers || []).length > 1 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-medium text-slate-900">当前模型</div>
              <div className="mt-1 text-xs text-slate-500">
                你配置了多个 AI 接口，这里可以按次切换本轮分析要使用的模型。
              </div>
            </div>
            <select
              className="min-w-[280px] rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900"
              value={selectedProviderId}
              onChange={(event) => setSelectedProviderId(event.target.value)}
            >
              {(configInfo?.providers || []).map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name || "未命名接口"} · {provider.model || "未配置模型"}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-6 lg:flex-row">
        <section
          style={leftPanelStyle}
          className={`rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_10px_35px_rgba(15,23,42,0.06)] transition-all duration-500 ${
            draftTask ? "lg:-translate-x-1 lg:scale-[0.99]" : ""
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-slate-900">
                <Bot size={18} />
                <h2 className="text-lg font-semibold">对话分析区</h2>
              </div>
              <p className="mt-2 text-sm text-slate-500">
                按回车直接发送，按 Shift + Enter 换行。
              </p>
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
              draftTask ? "h-[540px]" : "h-[460px]"
            }`}
          >
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white px-6 text-center">
                <Sparkles className="h-10 w-10 text-emerald-500" />
                <div className="mt-4 text-base font-medium text-slate-900">
                  先描述一个作业场景
                </div>
                <div className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  例如“污水池内部检修，需要 2 人进入，现场潮湿，有临时用电和气体检测要求”。
                </div>
              </div>
            ) : null}

            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`whitespace-pre-line rounded-3xl px-4 py-3 text-sm leading-6 ${
                  message.role === "user"
                    ? "ml-10 border border-emerald-100 bg-emerald-100 text-emerald-950"
                    : "mr-10 border border-slate-200 bg-white text-slate-700 shadow-sm"
                }`}
              >
                {message.content}
              </div>
            ))}

            {loading ? (
              <div className="mr-10 inline-flex items-center gap-2 rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                AI 正在分析现场风险...
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex gap-3">
            <textarea
              className="min-h-28 flex-1 rounded-3xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleTextareaKeyDown}
              placeholder="输入作业描述，例如：车间顶部灯具更换，使用登高车，作业高度约 8 米，2 人施工，周边有通行人员。"
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
        </section>

        <aside
          style={rightPanelStyle}
          className={`rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_10px_35px_rgba(15,23,42,0.06)] transition-all duration-500 ${
            draftTask ? "lg:-translate-x-3 ring-1 ring-emerald-100" : "lg:scale-[0.985]"
          }`}
        >
          <div className="flex items-center gap-2 text-slate-900">
            <CheckCircle2 size={18} />
            <h2 className="text-lg font-semibold">任务草稿</h2>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            票证放在最上方。选中的票证代表必须办理，且现场必须拍照上传。风险和票证默认全选，你可以按需取消。
          </p>

          {draftTask ? (
            <div className="mt-5 space-y-5 text-sm text-slate-700">
              <div className="rounded-3xl bg-[linear-gradient(135deg,#f7fafc_0%,#eefcf6_100%)] p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  草稿标题
                </div>
                <div className="mt-2 text-base font-semibold text-slate-900">
                  {draftTask.title}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-3xl bg-amber-50 px-4 py-3">
                  <div className="text-xs text-amber-700">必办票证</div>
                  <div className="mt-1 text-xl font-semibold text-amber-900">
                    {selectedPermits.length}
                  </div>
                </div>
                <div className="rounded-3xl bg-emerald-50 px-4 py-3">
                  <div className="text-xs text-emerald-700">下发风险</div>
                  <div className="mt-1 text-xl font-semibold text-emerald-900">
                    {selectedRiskItems.length}
                  </div>
                </div>
                <div className="rounded-3xl bg-slate-50 px-4 py-3">
                  <div className="text-xs text-slate-500">识别风险</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">
                    {draftTask.items?.length || 0}
                  </div>
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
                      onClick={selectAllPermits}
                      className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700 transition hover:bg-amber-100"
                    >
                      全选
                    </button>
                    <button
                      type="button"
                      onClick={clearPermitSelection}
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
                      return (
                        <button
                          key={`${permit.type}-${index}`}
                          type="button"
                          onClick={() => togglePermit(index)}
                          className={`w-full rounded-3xl border px-4 py-4 text-left transition ${
                            selected
                              ? "border-amber-300 bg-amber-50 shadow-sm"
                              : "border-slate-200 bg-white"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <SelectDot selected={selected} tone="amber" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-3">
                                <div className="font-medium text-slate-900">
                                  {permitLabel(permit.type)}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                                    必须办票
                                  </span>
                                  {selected ? (
                                    <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800">
                                      已选中
                                    </span>
                                  ) : null}
                                </div>
                              </div>

                              <div className="mt-2 text-xs leading-5 text-slate-700">
                                {permitReason(permit)}
                              </div>

                              <div className="mt-3 rounded-2xl border border-amber-200 bg-white/90 px-3 py-2 text-xs leading-5 text-amber-900">
                                必须拍照上传：选中的票证必须办理，现场上传办票照片后才算完成闭环。
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-3xl border border-slate-200 bg-slate-50 px-3 py-3 text-slate-500">
                    当前草稿没有识别出必须办理的票证。
                  </div>
                )}
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 font-medium text-slate-900">
                    <AlertTriangle size={16} className="text-emerald-500" />
                    待下发风险
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={selectAllRisks}
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700 transition hover:bg-emerald-100"
                    >
                      全选
                    </button>
                    <button
                      type="button"
                      onClick={clearRiskSelection}
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 transition hover:bg-slate-100"
                    >
                      清空
                    </button>
                  </div>
                </div>

                <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
                  {(draftTask.items || []).map((item, index) => {
                    const selected = selectedRiskIndexes.includes(index);
                    return (
                      <button
                        key={`${item.risk_description}-${index}`}
                        type="button"
                        onClick={() => toggleRisk(index)}
                        className={`w-full rounded-3xl border px-4 py-4 text-left transition ${
                          selected
                            ? "border-emerald-200 bg-emerald-50/70 shadow-sm"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <SelectDot selected={selected} />

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-medium text-slate-500">
                                风险 {index + 1}
                              </div>
                              <span
                                className={`rounded-full px-2 py-1 text-xs font-medium ${severityTone(
                                  item.severity
                                )}`}
                              >
                                {SEVERITY_LABELS[item.severity] || "中风险"}
                              </span>
                            </div>

                            <div className="mt-2 text-sm leading-6 text-slate-900">
                              {normalizeText(item.risk_description, "待确认风险")}
                            </div>

                            {item.measure ? (
                              <div className="mt-3 rounded-2xl bg-white/80 px-3 py-2 text-xs leading-5 text-slate-700">
                                建议措施：{normalizeText(item.measure, "请现场补充控制措施")}
                              </div>
                            ) : null}
                          </div>

                          <ChevronRight
                            className={`h-4 w-4 shrink-0 text-slate-300 transition ${
                              selected ? "translate-x-0 text-emerald-500" : "translate-x-1"
                            }`}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  下发汇总
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-800">
                  将下发 <span className="font-semibold text-emerald-700">{selectedRiskItems.length}</span> 条风险，
                  必须办理 <span className="font-semibold text-amber-700">{selectedPermits.length}</span> 张票证。
                </div>
              </div>

              <div className="grid gap-4">
                <div>
                  <label className="mb-2 block font-medium text-slate-900">所属区域</label>
                  <select
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                    value={createForm.area_id}
                    onChange={(event) =>
                      setCreateForm({ ...createForm, area_id: event.target.value })
                    }
                    disabled={optionsLoading}
                  >
                    <option value="">
                      {optionsLoading ? "区域加载中..." : "请选择区域"}
                    </option>
                    {areas.map((area) => (
                      <option key={area.id} value={area.id}>
                        {area.name}
                      </option>
                    ))}
                  </select>
                  {selectedArea ? (
                    <div className="mt-2 text-xs text-slate-500">
                      已选择：{selectedArea.name}
                    </div>
                  ) : null}
                </div>

                <div>
                  <label className="mb-2 block font-medium text-slate-900">
                    指派负责人
                  </label>
                  <select
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                    value={createForm.assignee_id}
                    onChange={(event) =>
                      setCreateForm({
                        ...createForm,
                        assignee_id: event.target.value,
                      })
                    }
                    disabled={optionsLoading}
                  >
                    <option value="">
                      {optionsLoading ? "负责人加载中..." : "请选择负责人"}
                    </option>
                    {assignees.map((assignee) => (
                      <option key={assignee.id} value={assignee.id}>
                        {assignee.real_name} ({assignee.username})
                      </option>
                    ))}
                  </select>
                  {selectedAssignee ? (
                    <div className="mt-2 text-xs text-slate-500">
                      已选择：{selectedAssignee.real_name}
                    </div>
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
                完成一轮 AI 分析后，这里会自动出现必须办理票证、风险清单和任务创建入口。
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
