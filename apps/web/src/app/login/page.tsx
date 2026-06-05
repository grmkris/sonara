"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { authClient } from "@/lib/auth-client";

type Mode = "signin" | "signup";

// Only accept same-origin relative paths as a post-login destination, so a
// crafted `?next=//evil.com` or `?next=https://…` can't turn login into an
// open redirect. Falls back to /play.
const safeNext = (next: string | null): string => {
  if (
    next &&
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.includes("://")
  ) {
    return next;
  }
  return "/play";
};

// Maps Better Auth + our APIError(code) values to friendly UI copy.
const friendlyError = (rawMessage: string | undefined): string => {
  if (!rawMessage) {
    return "Something went wrong. Try again.";
  }
  const msg = rawMessage.toLowerCase();
  if (msg.includes("invalid email or password")) {
    return "Wrong email or password.";
  }
  if (
    msg.includes("user already exists") ||
    msg.includes("user_already_exists")
  ) {
    return "An account with this email already exists. Try signing in.";
  }
  if (msg.includes("password") && msg.includes("short")) {
    return "Password must be at least 12 characters.";
  }
  return rawMessage;
};

const LoginForm = () => {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signin") {
        const res = await authClient.signIn.email({ email, password });
        if (res.error) {
          setError(friendlyError(res.error.message));
          return;
        }
      } else {
        if (!name.trim()) {
          setError("Display name is required.");
          return;
        }
        const res = await authClient.signUp.email({
          email,
          name: name.trim(),
          password,
        });
        if (res.error) {
          setError(friendlyError(res.error.message));
          return;
        }
      }
      router.push(next);
      router.refresh();
      // oxlint-disable-next-line catch-error-name -- REVIEW: `error` would shadow the outer error state; renamed to `err`
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(friendlyError(msg));
    } finally {
      setBusy(false);
    }
  };

  const isSignup = mode === "signup";
  const signInLabel = isSignup ? "Create account" : "Sign in";

  return (
    <main className="min-h-screen flex items-center justify-center bg-[color:var(--ink)] text-[color:var(--paper)] px-4">
      <div className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <h1 className="font-serif italic text-3xl mb-1">sonara</h1>
          <p className="text-sm opacity-60">
            {isSignup ? "Create an account" : "Sign in"}
          </p>
        </header>

        <form onSubmit={onSubmit} className="space-y-4">
          {isSignup && (
            <label className="block">
              <span className="text-xs uppercase tracking-wider opacity-60">
                Display name
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
                className="mt-1 w-full bg-transparent border-b border-white/20 focus:border-white/60 outline-none py-2 font-serif text-lg"
              />
            </label>
          )}

          <label className="block">
            <span className="text-xs uppercase tracking-wider opacity-60">
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              className="mt-1 w-full bg-transparent border-b border-white/20 focus:border-white/60 outline-none py-2 font-serif text-lg"
            />
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-wider opacity-60">
              Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isSignup ? "new-password" : "current-password"}
              required
              minLength={isSignup ? 12 : undefined}
              className="mt-1 w-full bg-transparent border-b border-white/20 focus:border-white/60 outline-none py-2 font-serif text-lg"
            />
            {isSignup && (
              <span className="text-xs opacity-50 mt-1 block">
                At least 12 characters.
              </span>
            )}
          </label>

          {error && (
            <p
              role="alert"
              className="text-sm text-[color:var(--accent)] opacity-90"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full mt-2 py-3 border border-white/30 hover:border-white/60 disabled:opacity-40 disabled:cursor-not-allowed font-serif italic text-lg transition-colors"
          >
            {busy ? "…" : signInLabel}
          </button>
        </form>

        <div className="mt-6 text-center text-sm opacity-70">
          {isSignup ? (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setError(null);
                }}
                className="underline hover:opacity-100"
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              New here?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
                className="underline hover:opacity-100"
              >
                Create an account
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
};

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
