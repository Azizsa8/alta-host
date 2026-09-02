import { useState } from "react";
import { api, type Staff } from "../api/client.js";

export function Login({ onLoggedIn }: { onLoggedIn: (staff: Staff) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const staff = await api.login(username.trim(), password);
      onLoggedIn(staff);
    } catch {
      setError("اسم المستخدم أو كلمة المرور غير صحيحة");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      dir="rtl"
      className="min-vh-100 d-flex align-items-center justify-content-center bg-gradient-dark"
      style={{ minHeight: "100vh" }}
    >
      <div className="card z-index-0" style={{ maxWidth: 420, width: "100%", margin: "0 16px" }}>
        <div className="card-header p-0 position-relative mt-n4 mx-3 z-index-2">
          <div className="bg-gradient-primary shadow-primary border-radius-lg py-3 pe-1 text-center">
            <h5 className="text-white mb-0">HostOps</h5>
            <p className="text-white text-sm opacity-8 mb-0">غرفة عمليات الضيافة</p>
          </div>
        </div>
        <div className="card-body">
          <form onSubmit={submit}>
            <div className="mb-3">
              <label className="form-label text-sm">اسم المستخدم</label>
              <input
                className="form-control"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
              />
            </div>
            <div className="mb-3">
              <label className="form-label text-sm">كلمة المرور</label>
              <input
                type="password"
                className="form-control"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            {error && <p className="text-danger text-sm mb-3">{error}</p>}
            <button className="btn bg-gradient-dark w-100 mb-0" disabled={loading || !username.trim() || !password}>
              {loading ? "جارٍ الدخول…" : "دخول"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
