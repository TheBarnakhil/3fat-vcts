import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export default async function Home() {
  const cookieStore = await cookies();
  const hasSession = cookieStore.get("vcts_access")?.value;
  redirect(hasSession ? "/dashboard" : "/login");
}
