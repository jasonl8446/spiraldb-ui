import { Link } from 'react-router-dom';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

/** Unknown path — the shell stays usable and points back at the dashboard. */
export default function NotFoundPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>Not found</CardTitle>
          <CardDescription>No route matches this path.</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <Link to="/" className="text-sm text-blue-400 underline-offset-4 hover:underline">
            Back to the dashboard
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
