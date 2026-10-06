import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ALLOWED_EMAILS } from "./config";

export async function requireAllowedUser() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const emails = user.emailAddresses.map(item => item.emailAddress.toLowerCase());
  const email = emails.find(item => ALLOWED_EMAILS.has(item));
  if (!email) redirect("/unauthorized");
  return { user, email };
}
