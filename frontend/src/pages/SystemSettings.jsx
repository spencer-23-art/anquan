import { useEffect, useMemo, useState } from "react";
import { Monitor, Moon, Plus, Sun, Trash2 } from "lucide-react";
import api from "../lib/axios";
import { useThemeStore } from "../stores/themeStore";

function createProvider(seed = {}) {
  return {
    id: seed.id || `provider-${Math.random().toString(16).slice(2, 10)}`,
    name: seed.name || "",
    base_url: seed.base_url || "",
    model: seed.model || "",
    api_key: "",
    api_key_masked: seed.api_key_masked || "",
    enabled: seed.enabled ?? true,
  };
}

const themeOptions = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "暗黑", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
];

export default function SystemSettings() {
  const [providers, setProviders] = useState([]);
  const [activeProviderId, setActiveProviderId] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const { mode, setMode } = useThemeStore();

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const { data } = await api.get("/ai/config");
        const loadedProviders = (data.providers || []).map((item) => createProvider(item));
        const safeProviders = loadedProviders.length
          ? loadedProviders
          : [createProvider({ name: "默认接口", model: "deepseek-ai/DeepSeek-V3" })];
        setProviders(safeProviders);
        setActiveProviderId(data.active_provider_id || safeProviders[0].id);
      } catch {
        setMessage("系统配置加载失败");
      }
    };

    loadConfig();
  }, []);

  const activeProvider = useMemo(
    () => providers.find((item) => item.id === activeProviderId) || providers[0],
    [providers, activeProviderId]
  );

  const updateProvider = (providerId, key, value) => {
    setProviders((current) =>
      current.map((item) => (item.id === providerId ? { ...item, [key]: value } : item))
    );
  };

  const addProvider = () => {
    const next = createProvider({ name: `接口 ${providers.length + 1}` });
    setProviders((current) => [...current, next]);
    if (!activeProviderId) {
      setActiveProviderId(next.id);
    }
  };

  const removeProvider = (providerId) => {
    setProviders((current) => {
      const filtered = current.filter((item) => item.id !== providerId);
      if (!filtered.length) {
        const fallback = createProvider({ name: "默认接口", model: "deepseek-ai/DeepSeek-V3" });
        setActiveProviderId(fallback.id);
        return [fallback];
      }
      if (providerId === activeProviderId) {
        setActiveProviderId(filtered[0].id);
      }
      return filtered;
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setMessage("");
    setSaving(true);

    try {
      await api.put("/ai/config", {
        active_provider_id: activeProviderId || providers[0]?.id || null,
        providers: providers.map((provider) => ({
          id: provider.id,
          name: provider.name,
          base_url: provider.base_url,
          model: provider.model,
          api_key: provider.api_key,
          enabled: provider.enabled,
        })),
      });

      setProviders((current) =>
        current.map((item) => ({
          ...item,
          api_key_masked: item.api_key ? "已更新" : item.api_key_masked,
          api_key: "",
        }))
      );
      setMessage("系统配置已保存");
    } catch {
      setMessage("系统配置保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-xl font-semibold text-card-foreground">系统设置</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {themeOptions.map((option) => {
            const Icon = option.icon;
            const active = mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setMode(option.value)}
                className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {option.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-xl font-semibold text-card-foreground">AI 接口配置中心</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          这里可以保存多个 AI 接口，并指定默认接口。AI 风险分析页面可以按次切换模型，罚单 AI 描述默认使用这里选中的接口。
        </p>
      </section>

      <form className="space-y-5" onSubmit={handleSubmit}>
        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-card-foreground">当前默认接口</div>
              <div className="mt-1 text-sm text-muted-foreground">
                默认接口会同步给罚单描述生成、AI 分析等功能使用。
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <select
                className="rounded-lg border border-input px-4 py-2.5 text-sm"
                value={activeProviderId}
                onChange={(event) => setActiveProviderId(event.target.value)}
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name || "未命名接口"} {provider.model ? ` · ${provider.model}` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={addProvider}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
              >
                <Plus className="h-4 w-4" />
                新增接口
              </button>
            </div>
          </div>

          {activeProvider ? (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              默认使用：{activeProvider.name || "未命名接口"}，模型：{activeProvider.model || "未配置"}
            </div>
          ) : null}
        </section>

        <div className="grid gap-5 xl:grid-cols-2">
          {providers.map((provider, index) => (
            <section
              key={provider.id}
              className={`rounded-lg border bg-card p-5 shadow-sm ${
                provider.id === activeProviderId ? "border-primary ring-2 ring-primary/15" : "border-border"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-muted-foreground">接口 {index + 1}</div>
                  <div className="mt-1 text-lg font-semibold text-card-foreground">
                    {provider.name || "未命名接口"}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-2 text-xs text-muted-foreground">
                    <input
                      type="radio"
                      name="active-provider"
                      checked={provider.id === activeProviderId}
                      onChange={() => setActiveProviderId(provider.id)}
                    />
                    设为默认
                  </label>
                  <button
                    type="button"
                    onClick={() => removeProvider(provider.id)}
                    className="rounded-lg border border-rose-200 px-3 py-2 text-rose-600 transition hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-5 grid gap-4">
                <label className="space-y-2">
                  <span className="block text-sm font-medium text-card-foreground">接口名称</span>
                  <input
                    className="w-full rounded-lg border border-input px-4 py-2.5"
                    value={provider.name}
                    onChange={(event) => updateProvider(provider.id, "name", event.target.value)}
                    placeholder="例如：硅基流动 / OpenAI / 备用接口"
                  />
                </label>

                <label className="space-y-2">
                  <span className="block text-sm font-medium text-card-foreground">接口地址</span>
                  <input
                    className="w-full rounded-lg border border-input px-4 py-2.5"
                    value={provider.base_url}
                    onChange={(event) => updateProvider(provider.id, "base_url", event.target.value)}
                    placeholder="例如：https://api.siliconflow.cn 或 https://api.openai.com/v1"
                  />
                </label>

                <label className="space-y-2">
                  <span className="block text-sm font-medium text-card-foreground">模型名称</span>
                  <input
                    className="w-full rounded-lg border border-input px-4 py-2.5"
                    value={provider.model}
                    onChange={(event) => updateProvider(provider.id, "model", event.target.value)}
                    placeholder="例如：deepseek-ai/DeepSeek-V3"
                  />
                </label>

                <label className="space-y-2">
                  <span className="block text-sm font-medium text-card-foreground">API Key</span>
                  <input
                    className="w-full rounded-lg border border-input px-4 py-2.5"
                    value={provider.api_key}
                    onChange={(event) => updateProvider(provider.id, "api_key", event.target.value)}
                    placeholder={provider.api_key_masked || "输入新的 API Key"}
                  />
                  <div className="text-xs text-muted-foreground">
                    留空则保持当前已保存的 Key 不变。
                  </div>
                </label>

                <label className="inline-flex items-center gap-3 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={provider.enabled}
                    onChange={(event) => updateProvider(provider.id, "enabled", event.target.checked)}
                  />
                  启用这个接口
                </label>
              </div>
            </section>
          ))}
        </div>

        {message ? (
          <div className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">{message}</div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="max-w-2xl text-sm text-muted-foreground">
            保存后，AI 风险分析页面顶部会出现接口/模型选择器。罚单 AI 描述默认使用这里选中的默认接口。
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "保存中..." : "保存配置"}
          </button>
        </div>
      </form>
    </div>
  );
}
