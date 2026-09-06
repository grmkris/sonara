"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-is-mobile";

export const InstrumentPanel = ({
  label,
  title,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) => {
  const mobile = useIsMobile();
  const trigger = <Button variant="ghost">{label}</Button>;
  if (mobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger render={trigger} />
        <SheetContent
          side="bottom"
          keepMounted
          className="instrument-panel instrument-panel-mobile"
        >
          <SheetTitle>{title}</SheetTitle>
          {children}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange} modal={false}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        side="top"
        sideOffset={16}
        keepMounted
        className="instrument-panel"
      >
        <div className="flex items-center justify-between gap-3">
          <PopoverTitle className="instrument-panel-title">
            {title}
          </PopoverTitle>
          <PopoverClose
            render={
              <Button size="icon" variant="ghost" aria-label="Close panel">
                <X />
              </Button>
            }
          />
        </div>
        {children}
      </PopoverContent>
    </Popover>
  );
};
