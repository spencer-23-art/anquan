import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Building2,
  ChevronRight,
  CirclePlus,
  FolderTree,
  Layers3,
  Loader2,
  MapPin,
  Pencil,
  Save,
} from "lucide-react";
import api from "../lib/axios";

const emptyDraft = { name: "", parent_id: "", description: "" };

function flattenAreas(areas) {
  const childrenByParent = areas.reduce((index, area) => {
    const key = area.parent_id || "root";
    index[key] = [...(index[key] || []), area];
    return index;
  }, {});
  const result = [];
  const walk = (parentKey, depth) => {
    (childrenByParent[parentKey] || [])
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
      .forEach((area) => {
        result.push({ ...area, depth });
        walk(area.id, depth + 1);
      });
  };
  walk("root", 0);
  return result;
}

export default function AreaManagement() {
  const [areas, setAreas] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [view, setView] = useState("active");
  const [createType, setCreateType] = useState("project");
  const [draft, setDraft] = useState(emptyDraft);
  const [editing, setEditing] = useState(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("success");

  const loadAreas = useCallback(async () => {
    setLoading(true);
    try {
      let response;
      try {
        response = await api.get("/areas", { params: { include_all: true, include_inactive: true } });
      } catch (error) {
        if (error?.response?.status !== 403) throw error;
        response = await api.get("/areas");
      }
      const nextAreas = response.data || [];
      setAreas(nextAreas);
      setSelectedId((current) => current || nextAreas.find((area) => area.is_active)?.id || nextAreas[0]?.id || null);
    } catch (error) {
      setMessage(error?.response?.data?.detail || "区域数据加载失败");
      setMessageTone("error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAreas();
  }, [loadAreas]);

  const flatAreas = useMemo(() => flattenAreas(areas), [areas]);
  const visibleAreas = useMemo(
    () => flatAreas.filter((area) => (view === "active" ? area.is_active : !area.is_active)),
    [flatAreas, view],
  );
  const activeProjects = useMemo(() => areas.filter((area) => !area.parent_id && area.is_active), [areas]);
  const selectedArea = useMemo(() => areas.find((area) => area.id === selectedId) || null, [areas, selectedId]);
  const metrics = useMemo(
    () => ({
      projects: activeProjects.length,
      workAreas: areas.filter((area) => area.parent_id && area.is_active).length,
      archived: areas.filter((area) => !area.is_active).length,
    }),
    [activeProjects, areas],
  );

  const selectArea = (area) => {
    setSelectedId(area.id);
    setEditing({
      name: area.name,
      parent_id: area.parent_id ? String(area.parent_id) : "",
      description: area.description || "",
    });
  };

  useEffect(() => {
    if (selectedArea) {
      setEditing({
        name: selectedArea.name,
        parent_id: selectedArea.parent_id ? String(selectedArea.parent_id) : "",
        description: selectedArea.description || "",
      });
    }
  }, [selectedArea]);

  const notify = (text, tone = "success") => {
    setMessage(text);
    setMessageTone(tone);
  };

  const createArea = async (event) => {
    event.preventDefault();
    if (!draft.name.trim()) {
      notify("请填写名称后再保存。", "error");
      return;
    }
    if (createType === "area" && !draft.parent_id) {
      notify("请先选择所属项目。", "error");
      return;
    }

    setSaving(true);
    try {
      const { data } = await api.post("/areas", {
        name: draft.name.trim(),
        parent_id: createType === "area" ? Number(draft.parent_id) : null,
        description: draft.description.trim() || null,
      });
      setDraft(emptyDraft);
      setSelectedId(data.id);
      notify(createType === "project" ? "项目已建立。" : "作业区已建立。");
      await loadAreas();
    } catch (error) {
      notify(error?.response?.data?.detail || "保存失败。", "error");
    } finally {
      setSaving(false);
    }
  };

  const saveSelectedArea = async (event) => {
    event.preventDefault();
    if (!selectedArea || !editing.name.trim()) return;
    setSaving(true);
    try {
      await api.put(`/areas/${selectedArea.id}`, {
        name: editing.name.trim(),
        parent_id: editing.parent_id ? Number(editing.parent_id) : null,
        description: editing.description.trim() || null,
      });
      notify("区域资料已保存。");
      await loadAreas();
    } catch (error) {
      notify(error?.response?.data?.detail || "区域资料保存失败。", "error");
    } finally {
      setSaving(false);
    }
  };

  const changeArchiveState = async (action) => {
    if (!selectedArea) return;
    const title = action === "archive" ? "归档" : "恢复";
    if (!window.confirm(`确认${title}“${selectedArea.name}”吗？${action === "archive" ? "其下作业区也会一并归档，历史记录仍会保留。" : ""}`)) return;
    setSaving(true);
    try {
      await api.post(`/areas/${selectedArea.id}/${action}`);
      notify(action === "archive" ? "区域已归档，历史业务记录未受影响。" : "区域已恢复使用。 ");
      await loadAreas();
    } catch (error) {
      notify(error?.response?.data?.detail || `${title}失败。`, "error");
    } finally {
      setSaving(false);
    }
  };

  const startCreateArea = (parentId = "") => {
    setCreateType(parentId ? "area" : "project");
    setDraft({ ...emptyDraft, parent_id: parentId ? String(parentId) : "" });
  };

  if (loading) {
    return <div className="flex min-h-56 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在加载区域台账</div>;
  }

  return (
    <div className="space-y-5 text-foreground">
      <header className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FolderTree className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold">项目与区域管理</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">用项目组织作业区。业务结束后归档，保留历史任务、票证和罚单的追溯关系。</p>
        </div>
        <div className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border bg-card text-center">
          <div className="px-4 py-2"><div className="text-lg font-semibold">{metrics.projects}</div><div className="text-xs text-muted-foreground">在用项目</div></div>
          <div className="px-4 py-2"><div className="text-lg font-semibold">{metrics.workAreas}</div><div className="text-xs text-muted-foreground">在用作业区</div></div>
          <div className="px-4 py-2"><div className="text-lg font-semibold">{metrics.archived}</div><div className="text-xs text-muted-foreground">已归档</div></div>
        </div>
      </header>

      {message ? <div className={`rounded-lg border px-4 py-3 text-sm ${messageTone === "error" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{message}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0 border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="inline-flex rounded-lg bg-muted p-1">
              <button type="button" onClick={() => setView("active")} className={`rounded-md px-3 py-1.5 text-sm ${view === "active" ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}>在用区域</button>
              <button type="button" onClick={() => setView("archived")} className={`rounded-md px-3 py-1.5 text-sm ${view === "archived" ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}>已归档</button>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => startCreateArea()} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"><Building2 className="h-4 w-4" />新建项目</button>
              <button type="button" onClick={() => startCreateArea(selectedArea?.is_active ? selectedArea.id : "")} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"><CirclePlus className="h-4 w-4" />新建作业区</button>
            </div>
          </div>
          <div className="divide-y divide-border">
            {visibleAreas.map((area) => {
              const isSelected = area.id === selectedId;
              return (
                <button key={area.id} type="button" onClick={() => selectArea(area)} className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${isSelected ? "bg-primary/8" : "hover:bg-muted/60"}`} style={{ paddingLeft: `${16 + area.depth * 24}px` }}>
                  {area.parent_id ? <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" /> : <Layers3 className="h-4 w-4 shrink-0 text-primary" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{area.name}</span>{!area.is_active ? <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">已归档</span> : null}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{area.description || (area.parent_id ? "作业区" : "项目")}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
            {!visibleAreas.length ? <div className="px-5 py-14 text-center text-sm text-muted-foreground">当前没有{view === "active" ? "在用" : "已归档"}区域。</div> : null}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="border border-border bg-card p-4">
            <div className="mb-4 flex items-center gap-2"><CirclePlus className="h-4 w-4 text-primary" /><h2 className="font-semibold">建立区域</h2></div>
            <div className="mb-4 inline-flex w-full rounded-lg bg-muted p-1">
              <button type="button" onClick={() => setCreateType("project")} className={`flex-1 rounded-md px-3 py-2 text-sm ${createType === "project" ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}>项目</button>
              <button type="button" onClick={() => setCreateType("area")} className={`flex-1 rounded-md px-3 py-2 text-sm ${createType === "area" ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}>作业区</button>
            </div>
            <form className="space-y-3" onSubmit={createArea}>
              {createType === "area" ? <select className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm" value={draft.parent_id} onChange={(event) => setDraft((current) => ({ ...current, parent_id: event.target.value }))}><option value="">选择所属项目</option>{activeProjects.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select> : null}
              <input className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder={createType === "project" ? "项目名称" : "作业区名称"} />
              <textarea className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="管理备注（可选）" />
              <button type="submit" disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"><CirclePlus className="h-4 w-4" />保存{createType === "project" ? "项目" : "作业区"}</button>
            </form>
          </section>

          <section className="border border-border bg-card p-4">
            <div className="mb-4 flex items-center gap-2"><Pencil className="h-4 w-4 text-primary" /><h2 className="font-semibold">区域资料</h2></div>
            {selectedArea ? <form className="space-y-3" onSubmit={saveSelectedArea}>
              <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{selectedArea.parent_id ? "作业区" : "项目"} · {selectedArea.is_active ? "在用" : "已归档"}</div>
              <input className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm" value={editing.name} onChange={(event) => setEditing((current) => ({ ...current, name: event.target.value }))} />
              <select className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm" value={editing.parent_id} onChange={(event) => setEditing((current) => ({ ...current, parent_id: event.target.value }))} disabled={!selectedArea.is_active}>
                <option value="">作为独立项目</option>
                {activeProjects.filter((area) => area.id !== selectedArea.id).map((area) => <option key={area.id} value={area.id}>归入：{area.name}</option>)}
              </select>
              <textarea className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm" value={editing.description} onChange={(event) => setEditing((current) => ({ ...current, description: event.target.value }))} disabled={!selectedArea.is_active} />
              {selectedArea.is_active ? <button type="submit" disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted disabled:opacity-60"><Save className="h-4 w-4" />保存资料</button> : null}
              <button type="button" onClick={() => changeArchiveState(selectedArea.is_active ? "archive" : "restore")} disabled={saving} className={`inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium ${selectedArea.is_active ? "border border-amber-200 text-amber-800 hover:bg-amber-50" : "border border-emerald-200 text-emerald-800 hover:bg-emerald-50"}`}>
                {selectedArea.is_active ? <Archive className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}{selectedArea.is_active ? "归档区域" : "恢复使用"}
              </button>
            </form> : <div className="py-8 text-center text-sm text-muted-foreground">从左侧选择一个项目或作业区。</div>}
          </section>
        </aside>
      </div>
    </div>
  );
}
