import { useEffect, useMemo, useState } from "react";
import { Building2, FolderTree, Plus, Trash2 } from "lucide-react";
import api from "../lib/axios";

function buildTree(areas) {
  const nodes = areas.map((area) => ({ ...area, children: [] }));
  const byId = new Map(nodes.map((area) => [area.id, area]));
  const roots = [];

  nodes.forEach((area) => {
    if (area.parent_id && byId.has(area.parent_id)) {
      byId.get(area.parent_id).children.push(area);
    } else {
      roots.push(area);
    }
  });

  const sortNodes = (items) => {
    items.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    items.forEach((item) => sortNodes(item.children));
  };
  sortNodes(roots);
  return roots;
}

export default function AreaManagement() {
  const [areas, setAreas] = useState([]);
  const [mode, setMode] = useState("project");
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [moveTargets, setMoveTargets] = useState({});

  const projectTree = useMemo(() => buildTree(areas), [areas]);
  const projects = useMemo(() => areas.filter((area) => !area.parent_id), [areas]);

  const loadAreas = async () => {
    const { data } = await api.get("/areas");
    setAreas(data || []);
  };

  useEffect(() => {
    loadAreas();
  }, []);

  useEffect(() => {
    if (mode === "child" && !projectId && projects[0]) {
      setProjectId(String(projects[0].id));
    }
  }, [mode, projectId, projects]);

  const createArea = async (event) => {
    event.preventDefault();
    if (!name.trim()) {
      setMessage(mode === "project" ? "请先填写项目名称。" : "请先填写子区域名称。");
      return;
    }
    if (mode === "child" && !projectId) {
      setMessage("请先选择所属项目。");
      return;
    }

    try {
      await api.post("/areas", {
        name: name.trim(),
        parent_id: mode === "child" ? Number(projectId) : null,
        description,
      });
      setName("");
      setDescription("");
      setMessage(mode === "project" ? "项目已保存。" : "子区域已保存。");
      await loadAreas();
    } catch (error) {
      setMessage(error?.response?.data?.detail || "保存失败");
    }
  };

  const deleteArea = async (areaId) => {
    if (!window.confirm("确定删除吗？如果项目下面有子区域，也会一起删除。")) return;
    try {
      await api.delete(`/areas/${areaId}`);
      setMessage("已删除。");
      await loadAreas();
    } catch (error) {
      setMessage(error?.response?.data?.detail || "删除失败");
    }
  };

  const moveArea = async (areaId) => {
    const targetId = moveTargets[areaId];
    if (!targetId) {
      setMessage("请先选择要归入的项目。");
      return;
    }

    try {
      await api.put(`/areas/${areaId}`, { parent_id: Number(targetId) });
      setMoveTargets((current) => ({ ...current, [areaId]: "" }));
      setMessage("区域已归入项目。");
      await loadAreas();
    } catch (error) {
      setMessage(error?.response?.data?.detail || "归入项目失败");
    }
  };

  const startAddChild = (areaId) => {
    setMode("child");
    setProjectId(String(areaId));
    setName("");
    setDescription("");
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <FolderTree className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold text-slate-900">项目区域树</h2>
        </div>

        <div className="mt-5 space-y-4">
          {projectTree.length ? (
            projectTree.map((project) => (
              <div key={project.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
                      <Building2 size={18} />
                      <span className="truncate">{project.name}</span>
                    </div>
                    <div className="mt-1 text-sm text-slate-500">{project.description || "一级项目"}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {project.children.length === 0 && projects.length > 1 ? (
                      <>
                        <select
                          className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700"
                          value={moveTargets[project.id] || ""}
                          onChange={(event) => setMoveTargets((current) => ({ ...current, [project.id]: event.target.value }))}
                        >
                          <option value="">归入项目</option>
                          {projects
                            .filter((item) => item.id !== project.id)
                            .map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => moveArea(project.id)}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-100"
                        >
                          移动
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => startAddChild(project.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-100"
                    >
                      <Plus size={14} />
                      加子区域
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteArea(project.id)}
                      className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      title="删除项目"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {project.children.length ? (
                    project.children.map((child) => (
                      <div key={child.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-900">{child.name}</div>
                          <div className="mt-0.5 truncate text-xs text-slate-500">{child.description || "子区域"}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteArea(child.id)}
                          className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          title="删除子区域"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500 sm:col-span-2 xl:col-span-3">
                      这个项目下还没有子区域。
                    </div>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
              先新增一个一级项目。
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <Plus className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold text-slate-900">新增</h2>
        </div>

        <div className="mt-4 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setMode("project")}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${mode === "project" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
          >
            一级项目
          </button>
          <button
            type="button"
            onClick={() => setMode("child")}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${mode === "child" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
          >
            项目子区域
          </button>
        </div>

        {message ? <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">{message}</div> : null}

        <form className="mt-4 space-y-4" onSubmit={createArea}>
          {mode === "child" ? (
            <select className="w-full rounded-xl border border-slate-300 px-4 py-3" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          ) : null}

          <input
            className="w-full rounded-xl border border-slate-300 px-4 py-3"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={mode === "project" ? "项目名称，例如：心连心造粒塔" : "子区域名称，例如：厂房、尿素塔、三元肥"}
          />

          <textarea
            className="min-h-28 w-full rounded-xl border border-slate-300 px-4 py-3"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="备注描述"
          />

          <button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white">
            <Plus size={16} />
            {mode === "project" ? "保存项目" : "保存子区域"}
          </button>
        </form>
      </section>
    </div>
  );
}
