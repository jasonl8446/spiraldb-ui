import { useCallback, useState } from 'react';

import { ApiError } from '../lib/api';
import {
  fieldMapMessages,
  hasFieldMapMessages,
  type FieldValidationMessage,
} from '../lib/validation-message';

/**
 * Holds the **server's** validation findings for one form (story p5-04, AC3).
 *
 * A write that the server rejects with a 400 field map (D64/D65) has no client-side twin — the
 * rules that need the corpus live only on the server — so the page has to keep the map from the
 * failed mutation and render it (`components/shared/ValidationSummary.tsx`). Three calls, one
 * per lifecycle moment:
 *
 * - `capture(error)` on a failed save: keeps the map when the error carries one, and **clears**
 *   it otherwise, so a later failure with a different story cannot leave the previous summary up;
 * - `clear()` when a save starts or succeeds: a summary that describes a request the user has
 *   already moved past is worse than no summary;
 * - `messages` — the shared message shape, ready for the summary (and for the shared
 *   `FieldValidation` provider, if a host ever wants the inline placement too).
 */
export interface ServerValidation {
  messages: readonly FieldValidationMessage[];
  /** Keeps the field map a failed request returned; clears when it carried none. */
  capture: (error: unknown) => void;
  /** Drops the findings — call when a save begins and when one succeeds. */
  clear: () => void;
}

const NO_MESSAGES: readonly FieldValidationMessage[] = [];

export function useServerValidation(): ServerValidation {
  const [messages, setMessages] = useState<readonly FieldValidationMessage[]>(NO_MESSAGES);

  const capture = useCallback((error: unknown) => {
    setMessages(
      error instanceof ApiError && hasFieldMapMessages(error.fields)
        ? fieldMapMessages(error.fields)
        : NO_MESSAGES,
    );
  }, []);

  const clear = useCallback(() => {
    setMessages(NO_MESSAGES);
  }, []);

  return { messages, capture, clear };
}
