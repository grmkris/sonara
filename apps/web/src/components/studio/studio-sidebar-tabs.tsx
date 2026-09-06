"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type StudioTab = "recordings" | "sets";

export const StudioCreateNav = ({ visible }: { visible: boolean }) => visible ? (
  <nav aria-label="Studio workspaces" className="studio-create-nav">
    <Button variant="ghost" render={<Link href="/studio" />}>
      Recordings
    </Button>
    <Button variant="ghost" render={<Link href="/studio?tab=sets" />}>
      Sets
    </Button>
    <Button
      variant="outline"
      aria-current="page"
      render={<Link href="/studio/live" />}
    >
      Create
    </Button>
  </nav>
) : null;

export const StudioSidebarTabs = ({
  tab,
  onTab,
}: {
  tab: StudioTab;
  onTab: (tab: StudioTab) => void;
}) => (
  <nav aria-label="Studio" className="studio-workspace-nav">
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (value === "recordings" || value === "sets") {
          onTab(value);
        }
      }}
    >
      <TabsList aria-label="Your library">
        <TabsTrigger value="recordings">Recordings</TabsTrigger>
        <TabsTrigger value="sets">Sets</TabsTrigger>
      </TabsList>
    </Tabs>
    <Button variant="ghost" render={<Link href="/studio/live" />}>
      Create
    </Button>
  </nav>
);
