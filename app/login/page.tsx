"use client";

import { useState } from "react";
import { Check, LockKeyhole } from "lucide-react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand">
          <span><Check size={20} strokeWidth={3} /></span>
          Approve<span className="brand-dot">.</span>
        </div>
        <div className="login-icon"><LockKeyhole size={22} /></div>
        <p className="eyebrow">PRIVATE DASHBOARD</p>
        <h1>Sign in to continue</h1>
        <p className="login-copy">
          Use the shared access details provided by the workspace owner.
        </p>
        <form
          className="login-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setLoading(true);
            setError("");
            try {
              const response = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
              });
              const result = (await response.json()) as { error?: string };
              if (!response.ok) throw new Error(result.error || "Login failed.");
              window.location.assign("/");
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "Login failed.");
              setLoading(false);
            }
          }}
        >
          <label>
            Username
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error && <p className="login-error">{error}</p>}
          <button disabled={loading || !username || !password}>
            {loading ? "Signing in…" : "Open dashboard"}
          </button>
        </form>
      </section>
    </main>
  );
}
