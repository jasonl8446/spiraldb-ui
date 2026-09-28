import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as React from 'react';

import { cn } from '../../lib/utils';

/**
 * Popover primitive — vendored from shadcn/ui (task 1.8 decision D39).
 *
 * The `FriendlyNameDropdown` combobox anchors its cmdk list in a popover; Radix
 * supplies the collision-aware positioning, the Escape handling, `aria-expanded`
 * on the trigger and the focus management that the accessibility rules expect
 * (docs/spec-ui-design.md L540-550).
 */
const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'start', sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        // Radix moves focus into this panel on open, so `outline-none` needs the spec's
        // ring as its replacement — the p5-05 audit found it was one of only two
        // `outline-none` sites with nothing after it (docs/evidence/phase-5/p5-05-d1-audit.md
        // §3). It is `focus-visible`, so Radix's programmatic open-focus does not flash a
        // ring around the whole panel.
        'z-50 w-72 rounded-md border border-zinc-800 bg-zinc-900 p-2 text-zinc-50 shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
