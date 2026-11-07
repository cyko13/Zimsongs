import { getStore } from "@netlify/blobs";
import { summary, castVote, validVote, runMigrations } from "./core.mjs";
import migrations from "./migrations.mjs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async (req) => {
  const store = getStore({ name: "votes", consistency: "strong" });
  try {
    await runMigrations(store, migrations);
    if (req.method === "GET") return json(await summary(store));
    if (req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
      const v = validVote(body);
      if (!v) return json({ error: "bad vote" }, 400);
      await castVote(store, v);
      return json({ ok: true });
    }
    return json({ error: "method not allowed" }, 405);
  } catch (e) {
    console.error("votes error", e);
    return json({ error: "server error" }, 500);
  }
};

export const config = { path: "/api/votes", method: ["GET", "POST"] };
