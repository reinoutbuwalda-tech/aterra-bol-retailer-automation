import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { redirect } from "next/navigation";

export type AppRole = "owner" | "architect" | "accountant";
export type Actor = { email: string; name: string; role: AppRole };

const ACCESS: Record<string, AppRole> = {
  "reinout.buwalda@gmail.com": "owner",
  "aterra.eu@gmail.com": "owner",
  "t.w.dewaard@gmail.com": "owner",
  "hiddebaron@live.nl": "architect",
};

function actorFor(email: string, name?: string | null): Actor | null {
  const normalized = email.toLowerCase();
  const role = ACCESS[normalized];
  return role ? { email: normalized, name: name || normalized.split("@")[0], role } : null;
}

export async function getActor(): Promise<Actor> {
  if (process.env.NODE_ENV !== "production") return { email: "reinout.buwalda@gmail.com", name: "Reinout", role: "owner" };
  const user = await requireChatGPTUser("/");
  const actor = actorFor(user.email, user.fullName);
  if (!actor) redirect("/unauthorized");
  return actor;
}

export async function getApiActor(): Promise<Actor | null> {
  if (process.env.NODE_ENV !== "production") return { email: "reinout.buwalda@gmail.com", name: "Reinout", role: "owner" };
  try { const user = await requireChatGPTUser("/"); return actorFor(user.email, user.fullName); } catch { return null; }
}
