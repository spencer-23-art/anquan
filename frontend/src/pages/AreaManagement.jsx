import { useEffect, useState } from "react";
import api from "../lib/axios";

export default function AreaManagement() {
  const [areas, setAreas] = useState([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const loadAreas = async () => {
    const { data } = await api.get("/areas");
    setAreas(data);
  };

  useEffect(() => {
    loadAreas();
  }, []);

  const createArea = async (event) => {
    event.preventDefault();
    await api.post("/areas", { name, description });
    setName("");
    setDescription("");
    loadAreas();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr,1fr]">
      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-900">区域列表</h2>
        <div className="mt-4 space-y-3">
          {areas.map((area) => (
            <div
              key={area.id}
              className="rounded-xl border border-slate-200 px-4 py-3"
            >
              <div className="font-medium text-slate-900">{area.name}</div>
              <div className="mt-1 text-sm text-slate-500">
                {area.description || "暂无描述"}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-900">新增区域</h2>
        <form className="mt-4 space-y-4" onSubmit={createArea}>
          <input
            className="w-full rounded-lg border border-slate-300 px-4 py-3"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="区域名称"
          />
          <textarea
            className="min-h-28 w-full rounded-lg border border-slate-300 px-4 py-3"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="区域描述"
          />
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-5 py-3 text-sm font-medium text-white"
          >
            保存区域
          </button>
        </form>
      </section>
    </div>
  );
}
