import { redirect } from "next/navigation";

export default async function LegacySetConsoleRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/set/${id}/control`);
}
