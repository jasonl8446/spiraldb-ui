using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;

using Imcodec.ObjectProperty;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;

namespace WadScan;

/// <summary>
/// `wad-scan extract` — batch deserialize + emit (task 6.2).
///
/// The shipped `imcodec` CLI has no batch mode: it deserializes one file per process, measured at
/// **78 s per 400 files** (≈22 min for the 6,733 zone-data files). This command does the same work
/// in-process — one index pass over the tree, one payload read per *selected* entry, and the same
/// call `imcodec op file` makes:
///
/// ```csharp
/// new BindSerializer().Deserialize&lt;PropertyClass&gt;(payload, out var value)
/// ```
///
/// Nothing is written to stdout; the NDJSON rows go to `--out` and the summary and any error go to
/// stderr, so a caller can stream the file without a second channel to demultiplex (the same split
/// `tools/PacketReaderCli` uses for its JSON contract).
///
/// ## One row per selected entry, always
///
/// A row is emitted for **every** entry the globs select, whether or not it deserialized: the row
/// count is the selection's contract (6,733 against the real tree), and dropping an entry that
/// failed to deserialize would silently under-report the selection. A failed entry carries
/// `"error"` (and the header hash when one was readable) instead of `"class"`/`"object"`; a run
/// whose summary says `failed 0` therefore means every selected payload deserialized.
///
/// ## A fresh serializer per entry — not a style choice
///
/// `BindSerializer.Deserialize` sets its own `SerializerFlags.SerializeFlags` bit when it sees the
/// `BINd` magic, and that bit makes the serializer read a 4-byte flags word before the class hash.
/// A reused instance that has already deserialized one shape-A payload would therefore read the
/// **hash itself** as flags on the next shape-B payload and then look for a class hash 4 bytes too
/// late — matching the zone `gamedata.bin` files not at all. One instance per row costs nothing and
/// removes the hazard rather than depending on entry order.
/// </summary>
internal static class Extract {

    public static int Run(Options options) {
        if (string.IsNullOrEmpty(options.Gamedata)) {
            throw new UsageException("missing required argument: --gamedata <dir>");
        }

        if (!Directory.Exists(options.Gamedata)) {
            throw new UsageException($"--gamedata directory not found: {options.Gamedata}");
        }

        if (options.Select.Count == 0) {
            throw new UsageException("missing required argument: --select <glob,glob>");
        }

        if (string.IsNullOrEmpty(options.Out)) {
            throw new UsageException("missing required argument: --out <ndjson>");
        }

        var matchers = options.Select
            .Select(glob => (Glob: glob, Pattern: Glob.ToRegex(glob)))
            .ToList();
        var wads = WadTree.FindWads(options.Gamedata);
        var settings = new JsonSerializerSettings {
            // The same enum representation `imcodec op file` writes: `ACTIVITY_NotActivity`, not 3.
            Converters = { new StringEnumConverter() },
            Formatting = Formatting.None,
        };
        var json = JsonSerializer.Create(settings);
        var perGlob = new Dictionary<string, long>(StringComparer.Ordinal);
        long written = 0;
        long failed = 0;
        var unreadable = new List<string>();

        var outputPath = System.IO.Path.GetFullPath(options.Out);
        var directory = System.IO.Path.GetDirectoryName(outputPath);

        if (!string.IsNullOrEmpty(directory)) {
            Directory.CreateDirectory(directory);
        }

        var stopwatch = Stopwatch.StartNew();

        // UTF-8 without a BOM and "\n" line endings: NDJSON, one compact row per line.
        using (var writer = new StreamWriter(File.Create(outputPath), new UTF8Encoding(false)) { NewLine = "\n" }) {
            foreach (var path in wads) {
                WadFile wad;

                try {
                    wad = new WadFile(path);
                }
                catch (Exception exception) {
                    unreadable.Add($"{System.IO.Path.GetFileName(path)}: {Program.Describe(exception)}");
                    continue;
                }

                using (wad) {
                    foreach (var selection in Select(wad, matchers)) {
                        var row = BuildRow(wad, selection, json, out var ok);
                        writer.WriteLine(row.ToString(Formatting.None));

                        written++;
                        perGlob[selection.Glob] = perGlob.GetValueOrDefault(selection.Glob) + 1;

                        if (!ok) {
                            failed++;
                        }
                    }
                }
            }
        }

        stopwatch.Stop();

        var breakdown = string.Join(
            ", ",
            options.Select.Select(glob => $"{glob} {perGlob.GetValueOrDefault(glob)}"));

        Console.Error.WriteLine(FormattableString.Invariant(
            $"wad-scan extract: {written} row(s) in {stopwatch.ElapsedMilliseconds} ms ({breakdown}); deserialized {written - failed}, failed {failed}; unreadable archives {unreadable.Count}; out {outputPath}"));

        foreach (var error in unreadable) {
            Console.Error.WriteLine($"error: {error}");
        }

        return 0;
    }

    /// <summary>
    /// The selected entries of one archive, in stored-name order so a run is reproducible (the
    /// archive's own dictionary iteration order is an implementation detail, not a contract).
    /// </summary>
    private static List<WadSelection> Select(
        WadFile wad,
        List<(string Glob, Regex Pattern)> matchers) {
        var selected = new List<WadSelection>();

        foreach (var lazyEntry in wad.Archive.Files.Values) {
            var entry = lazyEntry.Value;

            if (entry.FileName is null) {
                continue;
            }

            foreach (var (glob, pattern) in matchers) {
                // First matching glob wins — the same attribution rule as `selectEntries`.
                if (pattern.IsMatch(entry.FileName)) {
                    selected.Add(new WadSelection(wad.Path, wad.Name, entry, glob));
                    break;
                }
            }
        }

        selected.Sort((left, right) => string.CompareOrdinal(left.Entry.FileName, right.Entry.FileName));

        return selected;
    }

    private static JObject BuildRow(
        WadFile wad,
        WadSelection selection,
        JsonSerializer json,
        out bool ok) {
        var row = new JObject {
            ["wad"] = wad.Name,
            ["entry"] = selection.Entry.FileName,
        };

        byte[]? payload;

        try {
            payload = wad.ReadAll(selection.Entry);
        }
        catch (Exception exception) {
            ok = false;
            row["error"] = $"payload read failed: {Program.Describe(exception)}";

            return row;
        }

        if (payload is null) {
            ok = false;
            row["error"] = "payload could not be read (entry not found in the archive)";

            return row;
        }

        var headerHash = HeaderHash(payload);

        try {
            var serializer = new BindSerializer();

            if (serializer.Deserialize<PropertyClass>(payload, out var value) && value is not null) {
                ok = true;
                row["class"] = value.GetType().Name;
                row["hash"] = value.GetHash();
                row["object"] = JToken.FromObject(value, json);

                return row;
            }
        }
        catch (Exception exception) {
            ok = false;
            row["error"] = $"deserialize threw: {Program.Describe(exception)}";

            if (headerHash is not null) {
                row["hash"] = headerHash.Value;
            }

            return row;
        }

        ok = false;
        row["error"] = headerHash is null
            ? "no class hash in the payload header"
            : $"no registered object-property type for class hash {headerHash.Value}";

        if (headerHash is not null) {
            row["hash"] = headerHash.Value;
        }

        return row;
    }

    /// <summary>
    /// The class hash the payload declares: at offset 8 behind the `BINd` header, or at offset 0
    /// bare. `null` when neither shape fits — reported instead of a guessed hash.
    /// </summary>
    private static uint? HeaderHash(byte[] payload) {
        if (payload.Length >= 12 && payload[0] == 'B' && payload[1] == 'I' && payload[2] == 'N' && payload[3] == 'd') {
            return BitConverter.ToUInt32(payload, 8);
        }

        return payload.Length >= 4 ? BitConverter.ToUInt32(payload, 0) : null;
    }
}