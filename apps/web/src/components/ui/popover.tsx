"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import * as React from "react";

import { cn } from "@/lib/utils";

const Popover = ({ ...props }: PopoverPrimitive.Root.Props) => (
  <PopoverPrimitive.Root {...props} />
);

const PopoverTrigger = ({
  asChild,
  children,
  ...props
}: PopoverPrimitive.Trigger.Props & {
  asChild?: boolean;
  children?: React.ReactNode;
}) => {
  if (asChild && React.isValidElement(children)) {
    return (
      <PopoverPrimitive.Trigger
        data-slot="popover-trigger"
        render={children as React.ReactElement}
        {...props}
      />
    );
  }
  return (
    <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props}>
      {children}
    </PopoverPrimitive.Trigger>
  );
};

const PopoverContent = ({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  keepMounted = false,
  ...props
}: PopoverPrimitive.Popup.Props & { keepMounted?: boolean } & Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) => (
  <PopoverPrimitive.Portal keepMounted={keepMounted}>
    <PopoverPrimitive.Positioner
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      className="isolate z-50"
    >
      <PopoverPrimitive.Popup
        data-slot="popover-content"
        className={cn(
          "w-80 origin-(--transform-origin) rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-2xl outline-none",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Positioner>
  </PopoverPrimitive.Portal>
);

const PopoverTitle = PopoverPrimitive.Title;
const PopoverClose = PopoverPrimitive.Close;
export { Popover, PopoverTrigger, PopoverContent, PopoverTitle, PopoverClose };
