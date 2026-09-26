import SharedComponentsPreview from '../components/SharedComponentsPreview';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import type { AppRoute } from '../lib/routes';

/**
 * Route stub (task 1.8, decision D39 item 7).
 *
 * Every route in the spec-api L325-350 table exists from this story on; the pages
 * that later phases build answer with their real title and the phase that brings
 * them, so the sidebar can be exercised end to end now (plan acceptance criterion
 * "sidebar navigates every route (stubs render)").
 *
 * Each stub also carries the shared-components smoke panel, which is where
 * `FriendlyNameDropdown` and `StatusBadge` are reachable before the editors land
 * (plan verification step 6: "dropdown smoke test on a stub page").
 */
export default function StubPage({ route }: { route: AppRoute }): JSX.Element {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{route.title}</CardTitle>
          <CardDescription>Arrives in Phase {route.phase}</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <p className="text-sm text-zinc-400">
            This route is wired into the shell; the page itself is built in Phase {route.phase}.
          </p>
          <p className="mt-3 font-mono text-xs text-zinc-500">{route.path}</p>
        </CardContent>
      </Card>

      <SharedComponentsPreview />
    </div>
  );
}
