import { getStore } from "@netlify/blobs";
import { getUser } from "@netlify/identity";
import type { Config } from "@netlify/functions";
import { isProject } from "../../lib/project";

type StoredDraft = { doc: unknown; updatedAt: string };

export default async (req: Request) => {
  const user = await getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const store = getStore({ name: "m3e-drafts", consistency: "strong" });
  const key = `${user.id}/current`;
  const current = await store.get(key, { type: "json" }) as StoredDraft | null;

  if (req.method === "GET") return Response.json(current ?? { doc: null, updatedAt: null });
  if (req.method !== "PUT") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const bodyText = await req.text();
  if (bodyText.length > 1_000_000) return Response.json({ error: "Draft too large" }, { status: 413 });
  let body: { doc?: unknown; baseUpdatedAt?: string | null };
  try { body = JSON.parse(bodyText); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!isProject(body.doc)) return Response.json({ error: "Invalid project" }, { status: 422 });
  if (current && body.baseUpdatedAt !== current.updatedAt) return Response.json(current, { status: 409 });

  const next = { doc: body.doc, updatedAt: new Date().toISOString() };
  await store.setJSON(key, next);
  return Response.json(next);
};

export const config: Config = { path: "/api/draft" };
