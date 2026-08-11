import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Download,
  FileText,
  History,
  Loader2,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import api from "../lib/axios";
import { compressImage } from "../lib/imageCompressor";

const defaultForm = {
  area_id: "",
  project_name: "",
  team_name: "",
  location: "",
  discovery_date: new Date().toISOString().split("T")[0],
  amount: "",
  description: "",
};

const amountChoices = [200, 300, 500, 1000, 2000, 5000];

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

export default function FineTicketCenter() {
  const [ticketType, setTicketType] = useState("safety");
  const [nextNumber, setNextNumber] = useState("--");
  const [form, setForm] = useState(defaultForm);
  const [summaryInput, setSummaryInput] = useState("");
  const [matchedRule, setMatchedRule] = useState("");
  const [photos, setPhotos] = useState([]);
  const [history, setHistory] = useState([]);
  const [areas, setAreas] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [generatingText, setGeneratingText] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("success");
  const [lastCreated, setLastCreated] = useState(null);
  const fileInputRef = useRef(null);

  const theme = useMemo(() => {
    if (ticketType === "safety") {
      return {
        icon: ShieldAlert,
        title: "在线安全罚单",
        card: "border-blue-200 bg-blue-50/70 dark:border-border dark:bg-[linear-gradient(135deg,#26313c_0%,#282f38_100%)]",
        button: "bg-blue-600 hover:bg-blue-700",
        soft: "bg-blue-100 text-blue-700",
        switchClass: "bg-blue-600 text-white shadow-sm",
      };
    }

    return {
      icon: TriangleAlert,
      title: "在线质量罚单",
      card: "border-amber-200 bg-amber-50/70 dark:border-border dark:bg-[linear-gradient(135deg,#342f26_0%,#302d2a_100%)]",
      button: "bg-amber-600 hover:bg-amber-700",
      soft: "bg-amber-100 text-amber-700",
      switchClass: "bg-amber-600 text-white shadow-sm",
    };
  }, [ticketType]);

  const areaOptions = useMemo(() => buildAreaOptions(areas), [areas]);
  const selectedArea = useMemo(
    () => areaOptions.find((area) => String(area.id) === String(form.area_id)) || null,
    [areaOptions, form.area_id],
  );
  const selectedProjectName = selectedArea?.name || form.project_name || "";

  const loadAreas = useCallback(async () => {
    try {
      const { data } = await api.get("/areas");
      const areaList = data || [];
      const options = buildAreaOptions(areaList);
      setAreas(areaList);
      setForm((prev) => {
        const nextAreaId = prev.area_id || String(options[0]?.id || "");
        const nextArea = options.find((area) => String(area.id) === String(nextAreaId));
        return {
          ...prev,
          area_id: nextAreaId,
          project_name: nextArea?.name || prev.project_name || "",
        };
      });
    } catch {
      setMessage("鍖哄煙鍔犺浇澶辫触");
      setMessageType("error");
    }
  }, []);

  const loadNextNumber = useCallback(async (type) => {
    try {
      const { data } = await api.get("/fines/next-number", { params: { type } });
      setNextNumber(data.number);
    } catch {
      setNextNumber("--");
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const { data } = await api.get("/fines/history");
      setHistory(data);
    } catch {
      setMessage("罚单历史加载失败");
      setMessageType("error");
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadNextNumber(ticketType);
  }, [loadNextNumber, ticketType]);

  useEffect(() => {
    loadHistory();
    loadAreas();
  }, [loadAreas, loadHistory]);

  const updateForm = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleAreaChange = (value) => {
    const nextArea = areaOptions.find((area) => String(area.id) === String(value));
    setForm((prev) => ({
      ...prev,
      area_id: value,
      project_name: nextArea?.name || "",
    }));
  };

  const addPhotos = async (files) => {
    const next = [...photos];
    for (const file of Array.from(files)) {
      if (next.length >= 9) {
        break;
      }
      const compressedFile = await compressImage(file);
      next.push({
        id: `${compressedFile.name}-${compressedFile.size}-${Math.random().toString(16).slice(2)}`,
        file: compressedFile,
        preview: URL.createObjectURL(compressedFile),
      });
    }
    setPhotos(next);
  };

  const removePhoto = (photoId) => {
    setPhotos((prev) => {
      const target = prev.find((item) => item.id === photoId);
      if (target) {
        URL.revokeObjectURL(target.preview);
      }
      return prev.filter((item) => item.id !== photoId);
    });
  };

  const handleGenerateDescription = async () => {
    if (!summaryInput.trim()) {
      setMessage("请先输入违规概况");
      setMessageType("error");
      return;
    }

    setGeneratingText(true);
    setMessage("");
    try {
      const { data } = await api.post("/fines/generate-description", {
        input: summaryInput,
        project_name: selectedProjectName,
        team_name: form.team_name,
        location: form.location,
        discovery_date: form.discovery_date,
        penalty_type: ticketType,
      });
      updateForm("description", data.description);
      setMatchedRule(data.rule_reference || "");
      setMessage("AI 描述已生成，你可以继续手动调整。");
      setMessageType("success");
    } catch {
      setMessage("AI 描述生成失败");
      setMessageType("error");
    } finally {
      setGeneratingText(false);
    }
  };

  const handleCreateTicket = async () => {
    if (!selectedProjectName || !form.team_name || !form.location || !form.amount || !form.description) {
      setMessage("请把项目名称、班组、部位、金额和正式描述填写完整");
      setMessageType("error");
      return;
    }

    setCreating(true);
    setMessage("");

    try {
      const payload = new FormData();
      payload.append("penalty_type", ticketType);
      if (form.area_id) {
        payload.append("area_id", form.area_id);
      }
      payload.append("project_name", selectedProjectName);
      payload.append("team_name", form.team_name);
      payload.append("location", form.location);
      payload.append("discovery_date", form.discovery_date);
      payload.append("amount", form.amount);
      payload.append("description", form.description);
      photos.forEach((item) => payload.append("photos", item.file));

      const { data } = await api.post("/fines", payload, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setLastCreated(data);
      setSummaryInput("");
      setForm((prev) => ({
        ...defaultForm,
        area_id: prev.area_id,
        project_name: selectedProjectName,
        discovery_date: new Date().toISOString().split("T")[0],
      }));
      photos.forEach((item) => URL.revokeObjectURL(item.preview));
      setPhotos([]);
      await Promise.all([loadHistory(), loadNextNumber(ticketType)]);
      setMessage(`罚单 ${data.number} 已生成`);
      setMessageType("success");
    } catch (error) {
      setMessage(error.response?.data?.detail || "罚单生成失败");
      setMessageType("error");
    } finally {
      setCreating(false);
    }
  };

  const handleDownload = async (item) => {
    try {
      const response = await api.get(item.download_url, { responseType: "blob" });
      const blobUrl = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `${item.number}.docx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      setMessage("罚单下载失败");
      setMessageType("error");
    }
  };

  const AccentIcon = theme.icon;

  return (
    <div className="space-y-6">
      <section className={`rounded-3xl border p-6 shadow-sm ${theme.card}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${theme.soft}`}>
              <AccentIcon className="h-4 w-4" />
              在线罚单模块已恢复
            </div>
            <h1 className="mt-4 text-3xl font-semibold text-slate-900">{theme.title}</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              这里可以先生成 AI 正式描述，再上传现场照片，最后导出为 Word 罚单。
            </p>
          </div>

          <div className="rounded-2xl border border-white/80 bg-white/90 px-5 py-4 shadow-sm">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">当前预览编号</div>
            <div className="mt-2 font-mono text-xl font-semibold text-slate-900">{nextNumber}</div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.8fr]">
        <section className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="inline-flex rounded-2xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setTicketType("safety")}
                className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${ticketType === "safety" ? "bg-blue-600 text-white shadow-sm" : "text-slate-600"}`}
              >
                安全罚单
              </button>
              <button
                type="button"
                onClick={() => setTicketType("quality")}
                className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${ticketType === "quality" ? "bg-amber-600 text-white shadow-sm" : "text-slate-600"}`}
              >
                质量罚单
              </button>
            </div>
            <div className="text-sm text-slate-500">默认把安全放在第一位，质量放在第二位。</div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">项目名称</span>
              <select
                className="w-full rounded-2xl border border-slate-300 px-4 py-3"
                value={form.area_id}
                onChange={(event) => handleAreaChange(event.target.value)}
              >
                <option value="">请选择项目</option>
                {areaOptions.map((area) => (
                  <option key={area.id} value={area.id}>{`${"  ".repeat(area.depth)}${area.name}`}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">受罚班组 / 责任人</span>
              <input
                className="w-full rounded-2xl border border-slate-300 px-4 py-3"
                value={form.team_name}
                onChange={(event) => updateForm("team_name", event.target.value)}
                placeholder="例如：木工班组 / 张三"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">违规部位</span>
              <input
                className="w-full rounded-2xl border border-slate-300 px-4 py-3"
                value={form.location}
                onChange={(event) => updateForm("location", event.target.value)}
                placeholder="例如：2 号楼 8 层东侧"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">发现日期</span>
              <input
                type="date"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3"
                value={form.discovery_date}
                onChange={(event) => updateForm("discovery_date", event.target.value)}
              />
            </label>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium text-slate-700">罚款金额</span>
            <div className="flex flex-wrap gap-2">
              {amountChoices.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => updateForm("amount", String(amount))}
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    String(amount) === String(form.amount)
                      ? theme.soft + " border-transparent"
                      : "border-slate-300 bg-white text-slate-600"
                  }`}
                >
                  ¥{amount}
                </button>
              ))}
              <input
                type="number"
                className="min-w-[180px] flex-1 rounded-2xl border border-slate-300 px-4 py-3"
                value={form.amount}
                onChange={(event) => updateForm("amount", event.target.value)}
                placeholder="手动输入金额"
              />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-3 rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                <Sparkles className="h-4 w-4" />
                违规概况
              </div>
              <textarea
                className="min-h-[180px] w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm"
                value={summaryInput}
                onChange={(event) => setSummaryInput(event.target.value)}
                placeholder="先写一段概况，例如：木工班组人员未按要求佩戴安全带，擅自进入临边高处作业区域。"
              />
              <button
                type="button"
                onClick={handleGenerateDescription}
                disabled={generatingText}
                className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium text-white transition ${theme.button} disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {generatingText ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                AI 生成正式描述
              </button>
            </div>

            {matchedRule ? (
              <div className="rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-800">
                已匹配规范依据：{matchedRule}
              </div>
            ) : null}

            <div className="space-y-3 rounded-3xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                <FileText className="h-4 w-4" />
                正式描述
              </div>
              <textarea
                className="min-h-[250px] w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm leading-7"
                value={form.description}
                onChange={(event) => updateForm("description", event.target.value)}
                placeholder="AI 生成后会出现在这里，你也可以直接手工修改最终描述。"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <Camera className="h-4 w-4" />
              现场照片
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {photos.map((photo) => (
                <div key={photo.id} className="group relative overflow-hidden rounded-2xl border border-slate-200">
                  <img src={photo.preview} alt="" className="h-32 w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(photo.id)}
                    className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-32 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500 transition hover:border-slate-400 hover:bg-slate-100"
              >
                添加照片
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => addPhotos(event.target.files || [])}
            />
          </div>

          {message ? (
            <div
              className={`rounded-2xl px-4 py-3 text-sm ${
                messageType === "error" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-700"
              }`}
            >
              {message}
            </div>
          ) : null}

          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={handleCreateTicket}
              disabled={creating}
              className={`rounded-2xl px-5 py-3 text-sm font-medium text-white transition ${theme.button} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {creating ? "生成中..." : "生成罚单"}
            </button>
          </div>
        </section>

        <aside className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <History className="h-4 w-4" />
              生成历史
            </div>
            <p className="mt-2 text-sm text-slate-500">最近生成的罚单会出现在这里，可直接下载。</p>
          </div>

          {lastCreated ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-sm font-medium text-emerald-800">最近生成</div>
              <div className="mt-2 text-sm text-emerald-900">{lastCreated.number}</div>
              <button
                type="button"
                onClick={() => handleDownload(lastCreated)}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-emerald-700"
              >
                <Download className="h-3.5 w-3.5" />
                立即下载
              </button>
            </div>
          ) : null}

          {loadingHistory ? (
            <div className="text-sm text-slate-500">正在加载历史...</div>
          ) : history.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
              还没有生成过罚单。
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((item) => (
                <div key={item.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">{item.number}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {item.project_name}{item.area_name ? ` 路 ${item.area_name}` : ""}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">开具人：{item.creator_name || "-"}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDownload(item)}
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700 transition hover:bg-slate-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      下载
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
