import { redirect } from "next/navigation";
import { connection } from "next/server";
import { appNavigation } from "@/server/navigation";

export default async function AppsHome() {
  await connection();
  redirect(appNavigation().navigation.items[0]?.href ?? "/resources");
}
