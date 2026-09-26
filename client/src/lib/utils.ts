import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * `cn()` — the class-name helper every vendored primitive uses (shadcn/ui style,
 * task 1.8 decision D39).
 *
 * `clsx` handles the conditional shapes (`{ 'opacity-50': disabled }`, arrays,
 * falsy values); `twMerge` then resolves Tailwind conflicts so the last-listed
 * utility wins — which is what makes `className` overrides on a primitive behave
 * the way callers expect (`<Button className="bg-red-600">` really is red).
 *
 * `tailwind-merge` is pinned to v2 because the project uses Tailwind v3; v3 of
 * tailwind-merge only understands Tailwind v4 class names (its README states
 * "if you use Tailwind v3, use tailwind-merge v2.6.0").
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
