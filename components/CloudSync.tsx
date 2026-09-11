"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AuthError, getUser, handleAuthCallback, login, logout, onAuthChange, signup, type User } from "@netlify/identity";
import type { Doc, Palette } from "@/lib/tokens";
import type { Lang } from "@/lib/i18n";

type Copy = {
  cloud: string; login: string; signup: string; logout: string; email: string; password: string;
  syncReady: string; syncing: string; saved: string; offline: string; confirmEmail: string;
  newer: string; loadCloud: string; close: string; switchLogin: string; switchSignup: string;
};

const COPY: Record<Lang, Copy> = {
  zh: { cloud: "云草稿", login: "登录", signup: "注册", logout: "退出登录", email: "邮箱", password: "密码（至少 6 位）", syncReady: "已连接云草稿", syncing: "正在同步…", saved: "已自动保存", offline: "同步暂不可用", confirmEmail: "请查收验证邮件，验证后再登录。", newer: "另一台设备保存了较新的版本。", loadCloud: "载入云端版本", close: "关闭", switchLogin: "已有账号？登录", switchSignup: "没有账号？注册" },
  en: { cloud: "Cloud draft", login: "Log in", signup: "Sign up", logout: "Log out", email: "Email", password: "Password (6+ characters)", syncReady: "Cloud draft connected", syncing: "Syncing…", saved: "Saved automatically", offline: "Sync unavailable", confirmEmail: "Check your email, confirm it, then log in.", newer: "Another device saved a newer version.", loadCloud: "Load cloud version", close: "Close", switchLogin: "Already registered? Log in", switchSignup: "Need an account? Sign up" },
  ja: { cloud: "クラウド下書き", login: "ログイン", signup: "登録", logout: "ログアウト", email: "メール", password: "パスワード（6文字以上）", syncReady: "クラウド下書きに接続済み", syncing: "同期中…", saved: "自動保存済み", offline: "同期を利用できません", confirmEmail: "確認メールを開いてからログインしてください。", newer: "別の端末に新しい版があります。", loadCloud: "クラウド版を開く", close: "閉じる", switchLogin: "登録済みですか？ログイン", switchSignup: "アカウントを作成" },
  ko: { cloud: "클라우드 초안", login: "로그인", signup: "가입", logout: "로그아웃", email: "이메일", password: "비밀번호(6자 이상)", syncReady: "클라우드 초안 연결됨", syncing: "동기화 중…", saved: "자동 저장됨", offline: "동기화를 사용할 수 없음", confirmEmail: "확인 메일을 연 뒤 로그인하세요.", newer: "다른 기기에 더 최신 버전이 있습니다.", loadCloud: "클라우드 버전 열기", close: "닫기", switchLogin: "계정이 있나요? 로그인", switchSignup: "계정 만들기" },
};

const SYNC_AT = "m3e:cloud:updated-at";

export function CloudSync({ doc, onCloudDoc, lang, p, hadStoredDoc }: { doc: Doc; onCloudDoc: (doc: Doc) => void; lang: Lang; p: Palette; hadStoredDoc: boolean }) {
  const c = COPY[lang];
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "syncing" | "saved" | "error" | "conflict">("idle");
  const [cloudDoc, setCloudDoc] = useState<Doc | null>(null);
  const hydrated = useRef(false);
  const updatedAt = useRef<string | null>(null);
  const latestDoc = useRef(doc);
  latestDoc.current = doc;

  const readCloud = async (current: User) => {
    setState("syncing");
    const response = await fetch("/api/draft", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`cloud ${response.status}`);
    const value = await response.json() as { doc: Doc | null; updatedAt: string | null };
    updatedAt.current = value.updatedAt;
    if (value.doc && !hadStoredDoc) onCloudDoc(value.doc);
    else if (value.doc && hadStoredDoc && localStorage.getItem(SYNC_AT) !== value.updatedAt && JSON.stringify(value.doc) !== JSON.stringify(latestDoc.current)) {
      setCloudDoc(value.doc);
      setState("conflict");
      hydrated.current = true;
      return;
    }
    hydrated.current = true;
    if (!value.doc) await writeCloud(latestDoc.current, current, null);
    else {
      if (value.updatedAt) localStorage.setItem(SYNC_AT, value.updatedAt);
      setState("saved");
    }
  };

  const writeCloud = async (next: Doc, _current: User, base: string | null = updatedAt.current) => {
    setState("syncing");
    const response = await fetch("/api/draft", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc: next, baseUpdatedAt: base }) });
    if (response.status === 409) {
      const value = await response.json() as { doc: Doc; updatedAt: string };
      setCloudDoc(value.doc);
      updatedAt.current = value.updatedAt;
      setState("conflict");
      return;
    }
    if (!response.ok) throw new Error(`cloud ${response.status}`);
    const value = await response.json() as { updatedAt: string };
    updatedAt.current = value.updatedAt;
    localStorage.setItem(SYNC_AT, value.updatedAt);
    setState("saved");
  };

  useEffect(() => {
    if (!location.hostname.endsWith("netlify.app")) return;
    let alive = true;
    void (async () => {
      try {
        await handleAuthCallback();
        const current = await getUser();
        if (!alive) return;
        setUser(current);
        if (current) await readCloud(current);
      } catch { if (alive) setState("error"); }
    })();
    return onAuthChange((_event, current) => {
      if (!alive) return;
      setUser(current);
      hydrated.current = false;
      if (current) void readCloud(current).catch(() => setState("error"));
      else setState("idle");
    });
  // Read the current browser's document once after authentication.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user || !hydrated.current || state === "conflict") return;
    const timer = window.setTimeout(() => void writeCloud(doc, user).catch(() => setState("error")), 1600);
    return () => window.clearTimeout(timer);
  // `state` is intentionally excluded so status updates do not schedule another write.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, user]);

  if (typeof window === "undefined" || !location.hostname.endsWith("netlify.app")) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setMessage(""); setState("syncing");
    try {
      if (mode === "signup") {
        const next = await signup(email, password, {});
        if (!next.confirmedAt) { setMessage(c.confirmEmail); setState("idle"); return; }
        setUser(next); await readCloud(next);
      } else {
        const next = await login(email, password); setUser(next); await readCloud(next);
      }
      setOpen(false);
    } catch (error) {
      setMessage(error instanceof AuthError ? error.message : c.offline); setState("error");
    }
  };

  const loadNewer = () => {
    if (!cloudDoc) return;
    onCloudDoc(cloudDoc);
    if (updatedAt.current) localStorage.setItem(SYNC_AT, updatedAt.current);
    setCloudDoc(null); setState("saved");
  };

  return <>
    <button onClick={() => setOpen(true)} title={user ? c.syncReady : c.login} style={{ position: "fixed", right: 14, top: 14, zIndex: 95, minHeight: 38, padding: "0 14px", border: `1px solid ${p.outlineVariant}`, borderRadius: 19, background: p.surfaceContainerHigh, color: p.onSurface, cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,.14)", fontWeight: 700 }}>
      {state === "syncing" ? c.syncing : user ? (state === "saved" ? `✓ ${c.cloud}` : c.cloud) : c.login}
    </button>
    {(open || state === "conflict") && <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 110, display: "grid", placeItems: "center", padding: 24, background: "rgba(0,0,0,.38)" }}>
      <div style={{ width: "min(390px, 100%)", padding: 24, borderRadius: 28, background: p.surfaceContainerHigh, color: p.onSurface, boxShadow: "0 16px 48px rgba(0,0,0,.25)" }}>
        <h2 style={{ margin: "0 0 18px", fontSize: 22 }}>{state === "conflict" ? c.newer : c.cloud}</h2>
        {state === "conflict" ? <button onClick={loadNewer} style={{ width: "100%", minHeight: 44, border: 0, borderRadius: 22, background: p.primary, color: p.onPrimary, fontWeight: 700, cursor: "pointer" }}>{c.loadCloud}</button> : user ? <>
          <p style={{ color: p.onSurfaceVariant }}>{user.email}<br />{state === "saved" ? c.saved : state === "error" ? c.offline : c.syncReady}</p>
          <button onClick={() => void logout()} style={{ minHeight: 40, padding: "0 18px", border: 0, borderRadius: 20, background: p.secondaryContainer, color: p.onSecondaryContainer, cursor: "pointer" }}>{c.logout}</button>
        </> : <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
          <input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={c.email} style={{ minHeight: 46, padding: "0 14px", borderRadius: 12, border: `1px solid ${p.outline}` }} />
          <input required minLength={6} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={c.password} style={{ minHeight: 46, padding: "0 14px", borderRadius: 12, border: `1px solid ${p.outline}` }} />
          {message && <p style={{ margin: 0, color: p.error, fontSize: 13 }}>{message}</p>}
          <button type="submit" style={{ minHeight: 44, border: 0, borderRadius: 22, background: p.primary, color: p.onPrimary, fontWeight: 700, cursor: "pointer" }}>{mode === "login" ? c.login : c.signup}</button>
          <button type="button" onClick={() => setMode(mode === "login" ? "signup" : "login")} style={{ border: 0, background: "transparent", color: p.primary, cursor: "pointer" }}>{mode === "login" ? c.switchSignup : c.switchLogin}</button>
        </form>}
        <button onClick={() => setOpen(false)} style={{ marginTop: 16, border: 0, background: "transparent", color: p.onSurfaceVariant, cursor: "pointer" }}>{c.close}</button>
      </div>
    </div>}
  </>;
}
