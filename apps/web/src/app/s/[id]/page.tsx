import { redirect } from "next/navigation";

// /s/<id> was the permalink path briefly (dev only) — /set/<id> is the
// readable home. Kept as a redirect so any link shared during testing
// survives ("the link never dies").
export default async function LegacySetRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/set/${id}`);
}
