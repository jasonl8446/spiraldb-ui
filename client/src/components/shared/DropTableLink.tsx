import { Link } from 'react-router-dom';

import { dropTablePath } from '../../lib/objects';

/**
 * A drop table's name as a link to its DropTable editor (D187).
 *
 * Shared by the Results cards, the Overview's rewards line and the read-only Results tab, so a
 * reward names the same table the same way everywhere. `known` says whether the names API holds
 * that table (`drop_tables`, the corpus's files): a name with no file — or one whose list has not
 * loaded — renders as plain text, never a dead link. A router `Link`, so leaving a dirty quest
 * editor goes through the same unsaved-changes guard as every other in-app navigation.
 */
export default function DropTableLink({
  name,
  known,
}: {
  name: string;
  known: boolean;
}): JSX.Element {
  if (!known) {
    return <span data-testid="drop-table-name">{name}</span>;
  }
  return (
    <Link
      to={dropTablePath(name)}
      data-testid="drop-table-link"
      className="underline decoration-zinc-600 underline-offset-2 hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      {name}
    </Link>
  );
}
