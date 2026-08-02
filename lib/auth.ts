import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export type AppRole = "owner" | "architect" | "accountant";
export type Actor = { email: string; name: string; role: AppRole };

const ACCESS: Record<string, AppRole> = {
  "reinout.buwalda@gmail.com": "owner",
  "aterra.eu@gmail.com": "owner",
  "t.w.dewaard@gmail.com": "owner",
  "hiddebaron@live.nl": "architect",
};

export function actorFor(email: string, name?: string | null): Actor | null {
  const normalized = email.toLowerCase();
  const role = ACCESS[normalized];
  return role ? { email: normalized, name: name || normalized.split("@")[0], role } : null;
}

export async function getActor(): Promise<Actor> {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const email = user.primaryEmailAddress?.emailAddress;
  const actor = email ? actorFor(email, user.fullName) : null;
  if (!actor) redirect("/unauthorized");
  return actor;
}

export async function getApiActor(): Promise<Actor | null> {
  try {
    const user = await currentUser();
    const email = user?.primaryEmailAddress?.emailAddress;
    return email ? actorFor(email, user?.fullName) : null;
  } catch { return null; }
}
