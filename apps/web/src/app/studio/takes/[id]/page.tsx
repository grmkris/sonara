"use client";

import { useParams } from "next/navigation";

import { TakeStudio } from "@/components/instrument/take-studio";

export default function TakePage() {
  const { id } = useParams<{ id: string }>();
  return <TakeStudio id={id} />;
}
