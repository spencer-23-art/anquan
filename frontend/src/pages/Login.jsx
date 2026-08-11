import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../lib/axios";
import { useAuthStore } from "../stores/auth";

const normalizeUsername = (value) =>
  String(value || "").normalize("NFKC").replace(/[\s\u200B-\u200D\uFEFF]/g, "");

export default function Login() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberLogin, setRememberLogin] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    const loginUsername = normalizeUsername(username);

    if (!loginUsername || !password) {
      setError("请输入用户名和密码");
      setLoading(false);
      return;
    }

    try {
      const { data } = await api.post("/auth/login", { username: loginUsername, password });
      login(data.user, data.access_token, rememberLogin);
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.detail || "登录失败，请检查账号和密码");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8 sm:px-6">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">安全巡检管理系统</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          登录后进入安全任务、作业许可、在线罚单等核心功能。
        </p>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">用户名</label>
            <input
              className="w-full rounded-lg border border-slate-300 px-4 py-3 text-base outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
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
              className="w-full rounded-lg border border-slate-300 px-4 py-3 text-base outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入密码"
              autoComplete="current-password"
            />
          </div>

          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <span className="font-medium">保持登录，下次自动进入</span>
            <input
              type="checkbox"
              checked={rememberLogin}
              onChange={(event) => setRememberLogin(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
          </label>

          {error ? (
            <div role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-emerald-700 px-4 py-3 font-medium text-white transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-emerald-300"
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
