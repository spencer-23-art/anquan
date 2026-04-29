import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../lib/axios";

const PASSWORD_REGEX = /^[\x20-\x7E]+$/;

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    username: "",
    real_name: "",
    phone: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!PASSWORD_REGEX.test(form.password)) {
      setError("密码只能使用英文、数字或常见符号。");
      return;
    }

    if (form.password.length < 6) {
      setError("密码至少需要 6 位。");
      return;
    }

    setLoading(true);

    try {
      await api.post("/auth/register", {
        username: form.username,
        real_name: form.real_name || form.username,
        phone: form.phone || null,
        password: form.password,
      });

      setSuccess("注册申请已提交，请等待管理员审核。");
      setTimeout(() => navigate("/login"), 1200);
    } catch (err) {
      setError(err.response?.data?.detail || "注册失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-slate-900">申请账号</h1>
        <p className="mt-2 text-sm text-slate-500">
          提交后由管理员审核，审核通过后即可登录系统。
        </p>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              用户名
            </label>
            <input
              className="w-full rounded-lg border border-slate-300 px-4 py-3 outline-none transition focus:border-emerald-500"
              value={form.username}
              onChange={updateField("username")}
              placeholder="请输入登录账号"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              真实姓名
            </label>
            <input
              className="w-full rounded-lg border border-slate-300 px-4 py-3 outline-none transition focus:border-emerald-500"
              value={form.real_name}
              onChange={updateField("real_name")}
              placeholder="请输入真实姓名"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              手机号
            </label>
            <input
              className="w-full rounded-lg border border-slate-300 px-4 py-3 outline-none transition focus:border-emerald-500"
              value={form.phone}
              onChange={updateField("phone")}
              placeholder="可选，用于联系和任务通知"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              密码
            </label>
            <input
              type="password"
              className="w-full rounded-lg border border-slate-300 px-4 py-3 outline-none transition focus:border-emerald-500"
              value={form.password}
              onChange={updateField("password")}
              placeholder="至少 6 位，支持英文、数字和符号"
              required
            />
          </div>

          {error ? (
            <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-600">
              {error}
            </div>
          ) : null}

          {success ? (
            <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {success}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-emerald-600 px-4 py-3 font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
          >
            {loading ? "提交中..." : "提交注册申请"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          已有账号？{" "}
          <Link className="font-medium text-emerald-600 hover:text-emerald-700" to="/login">
            返回登录
          </Link>
        </p>
      </div>
    </div>
  );
}
