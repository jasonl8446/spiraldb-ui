using System.Text.RegularExpressions;

using Imcodec.Wad;

namespace WadScan;

/// <summary>
/// One selected `{ wad, entry }` pair plus the glob that selected it — the unit both commands work in.
/// </summary>
/// <param name="WadPath">Absolute path of the archive the entry lives in.</param>
/// <param name="WadName">The archive's file name (what a row records as its provenance).</param>
/// <param name="Entry">The entry itself, carrying its byte range and stored size.</param>
/// <param name="Glob">The first glob of `--select` that matched the entry name.</param>
internal sealed record WadSelection(string WadPath, string WadName, FileEntry Entry, string Glob);

/// <summary>
/// Tree walk, archive index and bounded payload reads — the only place this tool touches a `*.wad`.
///
/// The index is parsed by **Imcodec's own** <see cref="ArchiveParser"/> (the parser the game's
/// tooling and `wadindex.ts` mirror), so this tool has no second index implementation to drift.
/// Payload reads are deliberately split in two:
///
///  * <see cref="ReadPrefix"/> reads at most <see cref="HeaderProbeBytes"/> **stored** bytes and
///    inflates only enough to recover a 12-byte object header. The census runs this over all
///    550,616 entries of the 19 GB tree; inflating every payload in full would read the whole tree
///    for 12 bytes per entry (the reference census makes the same choice, for the same reason).
///  * <see cref="ReadAll"/> delegates to <see cref="Archive.OpenFile"/> — the full-payload read
///    Imview itself uses — for the entries `extract` actually selected.
///
/// A failed read returns `null` rather than throwing: one unreadable entry must not hide the other
/// 550,615, and the census's job is a count, not a guarantee about any single file. A failed
/// *archive* is the caller's to report (it changes the "wads" denominator).
/// </summary>
internal sealed class WadFile : IDisposable {

    /// <summary>Compressed bytes read per entry for a header-only pass (the reference's 8 KB).</summary>
    public const int HeaderProbeBytes = 8192;

    /// <summary>Bytes that must be decompressed before a header is readable: "BINd"+flags+hash.</summary>
    public const int HeaderBytes = 12;

    private readonly FileStream _stream;

    public string Path { get; }
    public string Name { get; }
    public Archive Archive { get; }

    public WadFile(string path) {
        Path = path;
        Name = System.IO.Path.GetFileName(path);
        // The stream must outlive the parse: `Archive` seeks it for every `OpenFile`.
        _stream = File.OpenRead(path);
        try {
            Archive = ArchiveParser.Parse(_stream)
                ?? throw new InvalidDataException("ArchiveParser.Parse returned null");
        }
        catch {
            _stream.Dispose();
            throw;
        }
    }

    /// <summary>
    /// Up to <paramref name="want"/> decompressed bytes of an entry's payload, reading at most
    /// <paramref name="compressedLimit"/> stored bytes. `null` when the entry cannot supply them
    /// (truncated read, a corrupt zlib stream, or an entry whose data range is outside the file).
    /// </summary>
    public byte[]? ReadPrefix(FileEntry entry, int compressedLimit, int want) {
        var stored = entry.IsCompressed ? entry.CompressedSize : entry.UncompressedSize;
        var length = (int) Math.Min(stored, (uint) Math.Min(compressedLimit, int.MaxValue));

        if (length <= 0 || entry.Offset + (ulong) length > (ulong) _stream.Length) {
            return null;
        }

        var raw = new byte[length];
        _stream.Seek(entry.Offset, SeekOrigin.Begin);
        var read = 0;
        while (read < length) {
            var chunk = _stream.Read(raw, read, length - read);
            if (chunk <= 0) {
                return null;
            }
            read += chunk;
        }

        if (!entry.IsCompressed) {
            return raw.Length >= want ? raw : null;
        }

        return InflatePrefix(raw, want);
    }

    /// <summary>The entry's whole payload, exactly the way Imview reads it.</summary>
    public byte[]? ReadAll(FileEntry entry)
        => entry.FileName is null ? null : Archive.OpenFile(entry.FileName)?.ToArray();

    /// <summary>
    /// Inflate a (possibly truncated) zlib stream, keeping whatever comes out.
    ///
    /// The prefix read hands this a stream that is cut short on purpose, so the last `Read` either
    /// returns nothing or raises — Ionic's inflater reports a premature end as an exception rather
    /// than a short read. Both outcomes are the same to a caller that only needs the first
    /// <paramref name="want"/> bytes, so the exception is swallowed *after* the bytes already
    /// produced have been kept. A stream that yields fewer than `want` bytes is a failure (`null`),
    /// which is also how the reference census treats it.
    /// </summary>
    private static byte[]? InflatePrefix(byte[] compressed, int want) {
        var output = new MemoryStream(want);
        try {
            using var input = new MemoryStream(compressed, writable: false);
            using var zlib = new Ionic.Zlib.ZlibStream(input, Ionic.Zlib.CompressionMode.Decompress);

            var buffer = new byte[want];
            while (output.Length < want) {
                var inflated = zlib.Read(buffer, 0, buffer.Length);
                if (inflated <= 0) {
                    break;
                }
                output.Write(buffer, 0, inflated);
            }
        }
        catch (Exception) {
            // A truncated deflate stream: keep the bytes produced before it gave up.
        }

        return output.Length >= want ? output.ToArray() : null;
    }

    public void Dispose() => _stream.Dispose();
}

internal static class WadTree {

    /// <summary>
    /// Every `*.wad` under <paramref name="rootDir"/>, sorted ordinally so a run is reproducible.
    ///
    /// Recursive on purpose: `wadindex.ts` (the reader tasks 6.3+ consume) walks deeper, and this
    /// tool must select the same entries it would. The real tree has 3,589 `*.wad`, all of them at
    /// the top level, so today the walk and a top-level glob agree exactly.
    /// </summary>
    public static List<string> FindWads(string rootDir) {
        var paths = Directory.EnumerateFiles(rootDir, "*.wad", SearchOption.AllDirectories).ToList();
        paths.Sort(StringComparer.Ordinal);
        return paths;
    }
}

/// <summary>
/// Entry-name glob matching — the same semantics as `matchGlob` in
/// [wadindex.ts](../../server/src/services/sync/wadindex.ts), which is what the Phase 6 stories
/// select with:
///
///  * the **full stored entry name** is matched, case-sensitively, anchored at both ends;
///  * `*` and `?` stop at `/`, `**` crosses it — so a nested path needs `**` (e.g. `**/triggers.xml`);
///  * every other character is literal, which is why the flat `gamedata.bin` / `triggers.xml`
///    entries select with a bare name.
/// </summary>
internal static class Glob {

    public static Regex ToRegex(string glob) {
        var pattern = new System.Text.StringBuilder("^");

        for (var i = 0; i < glob.Length; i++) {
            var character = glob[i];

            if (character == '*') {
                if (i + 1 < glob.Length && glob[i + 1] == '*') {
                    pattern.Append(".*");
                    i++;
                }
                else {
                    pattern.Append("[^/]*");
                }
            }
            else if (character == '?') {
                pattern.Append("[^/]");
            }
            else {
                pattern.Append(Regex.Escape(character.ToString()));
            }
        }

        pattern.Append('$');

        return new Regex(pattern.ToString(), RegexOptions.CultureInvariant);
    }
}