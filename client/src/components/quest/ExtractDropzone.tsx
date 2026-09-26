import { Package } from 'lucide-react';
import { useRef, useState } from 'react';

import {
  ACCEPTED_EXTENSION,
  DROPZONE_PRIMARY,
  DROPZONE_SECONDARY,
  UPLOAD_FORMAT_HINT,
} from '../../lib/extract';
import { cn } from '../../lib/utils';

/**
 * The upload phase's drop zone (plan task 2.6, docs/spec-ui-design.md L191-204).
 *
 * Drag & drop **and** click-to-browse: the whole zone is a button that opens the
 * hidden `<input type="file" accept=".json">`, and the same input is what a drag
 * ultimately feeds. The copy is not written here — it comes from
 * `lib/extract.ts`, where the verbatim format line and the two drag lines are
 * unit-tested (the spec mockup's shortened format line is a trap; the domain
 * reference's wording is the contract).
 *
 * The drag-over state is the spec's own swap: `zinc-700`/`zinc-900/50` at rest,
 * `blue-500`/`blue-600/20` while dragging.
 */
export interface ExtractDropzoneProps {
  onFile: (file: File) => void;
}

export default function ExtractDropzone({ onFile }: ExtractDropzoneProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function pick(files: FileList | null | undefined): void {
    const file = files?.[0];
    if (file !== undefined) {
      onFile(file);
    }
  }

  return (
    <div
      data-drag-over={dragOver ? 'true' : 'false'}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        pick(event.dataTransfer?.files);
      }}
      className={cn(
        'rounded-xl border border-dashed p-10 text-center transition-colors',
        dragOver ? 'border-blue-500 bg-blue-600/20' : 'border-zinc-700 bg-zinc-900/50',
      )}
    >
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="mx-auto flex w-full flex-col items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
      >
        <Package className="h-12 w-12 text-zinc-500" aria-hidden="true" />
        <span className="text-lg text-zinc-100">{DROPZONE_PRIMARY}</span>
        <span className="text-sm text-zinc-400">{DROPZONE_SECONDARY}</span>
      </button>

      <p className="mt-6 text-sm text-zinc-500">{UPLOAD_FORMAT_HINT}</p>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSION}
        aria-label="Packet capture file"
        className="sr-only"
        onChange={(event) => {
          pick(event.target.files);
          // Reset so choosing the same file again still fires a change event.
          event.target.value = '';
        }}
      />
    </div>
  );
}
