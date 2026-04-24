import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../lib/axios";
import { useAuthStore } from "../stores/auth";

export default function Login() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const { data } = await api.post("/auth/login", { username, password });
      login(data.user, data.access_token);
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.detail || "登录失败，请检查账号和密码");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(160deg,#f8fafc_0%,#ecfdf5_45%,#eff6ff_100%)] px-4 py-8 sm:px-6">
      <div className="w-full max-w-md rounded-[28px] border border-white/80 bg-white/95 p-6 shadow-[0_20px_70px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">安全巡检管理系统</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          登录后进入作业许可、AI 风险分析、在线罚单等核心功能。
        </p>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">用户名</label>
            <input
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-base outline-none transition focus:border-emerald-500"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="请输入用户名"
              autoComplete="username"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">密码</label>
            <input
              type="password"
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-base outline-none transition focus:border-emerald-500"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入密码"
              autoComplete="current-password"
            />
          </div>

          {error ? (
            <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-emerald-600 px-4 py-3 font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
          >
            {loading ? "登录中..." : "登录"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          还没有账号？{" "}
          <Link className="font-medium text-emerald-600 hover:text-emerald-700" to="/register">
            去注册
          </Link>
        </p>
      </div>
    </div>
  );
}
