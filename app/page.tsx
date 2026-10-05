import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import Dashboard from "./dashboard";
export const dynamic = "force-dynamic";
export default async function Page() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <Dashboard user={user} />;
}
