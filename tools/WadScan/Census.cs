using System.Globalization;
using System.Text.Json;

namespace WadScan;

/// <summary>
/// `wad-scan census` — the class census (task 6.2), reproducing the measurement in
/// [docs/evidence/quest-catalog-findings.md](../../docs/evidence/quest-catalog-findings.md) and
/// [scripts/wad-census.mjs](../../scripts/wad-census.mjs): **183,676 object-property objects in 142
/// classes**, split by header shape.
///
/// Every one of the 550,616 WAD entries is read, and a payload is classified by the class hash at a
/// **fixed** header offset. There is no substring search, so a count has no false-positive risk.
/// Two shapes exist and a census that handles only the first is wrong by 160× on `WizZoneData`:
///
/// | Shape | Layout | Example |
/// |---|---|---|
/// | A | `BINd`(4) + flags(4) + classHash(4) at offset 8 | `triggers.xml`, `Tutorials/*.xml` |
/// | B | bare classHash(4) at offset 0 | every zone's `gamedata.bin` |
///
/// Shape B is recognised **only when the hash is a known class hash** (`--classes`): a bare 4-byte
/// value occurs constantly in binary data, so "it parses as a u32" is not evidence. That is the
/// reference's rule and it is kept here. Shape A needs no name table — the `BINd` magic is the
/// evidence — which is why the unresolved classes it carries (e.g. `WizZoneTriggers`' `0x06DAAC43`,
/// a hash `ClientDump.json` does not name) still appear in the totals.
/// </summary>
internal static class Census {

    public static int Run(Options options) {
        if (string.IsNullOrEmpty(options.Gamedata)) {
            throw new UsageException("missing required argument: --gamedata <dir>");
        }

        if (!Directory.Exists(options.Gamedata)) {
            throw new UsageException($"--gamedata directory not found: {options.Gamedata}");
        }

        var known = ClassNames.Load(options.Classes);
        var wads = WadTree.FindWads(options.Gamedata);

        var shapeA = new Dictionary<uint, int>();
        var shapeB = new Dictionary<uint, int>();
        var errors = new List<string>();

        foreach (var path in wads) {
            try {
                using var wad = new WadFile(path);

                foreach (var lazyEntry in wad.Archive.Files.Values) {
                    var entry = lazyEntry.Value;
                    var payload = wad.ReadPrefix(entry, WadFile.HeaderProbeBytes, WadFile.HeaderBytes);

                    if (payload is null) {
                        continue;
                    }

                    var shapeAHash = ClassHashShapeA(payload);

                    if (shapeAHash is not null) {
                        Bump(shapeA, shapeAHash.Value);
                        continue;
                    }

                    var shapeBHash = ClassHashShapeB(payload, known);

                    if (shapeBHash is not null) {
                        Bump(shapeB, shapeBHash.Value);
                    }
                }
            }
            catch (Exception exception) {
                errors.Add($"{System.IO.Path.GetFileName(path)}: {Program.Describe(exception)}");
            }
        }

        var aCount = shapeA.Values.Sum();
        var bCount = shapeB.Values.Sum();
        var total = aCount + bCount;
        var classes = shapeA.Count + shapeB.Count;

        var lines = new List<string> {
            FormattableString.Invariant($"wads: {wads.Count}"),
            FormattableString.Invariant($"object entries: shape A (BINd) {aCount} in {shapeA.Count} classes; shape B (bare) {bCount} in {shapeB.Count} classes"),
            FormattableString.Invariant($"object entries total: {total} in {classes} classes"),
            FormattableString.Invariant($"parse errors: {errors.Count}"),
            string.Empty,
            "class".PadRight(36) + " " + "count".PadLeft(6) + "  shape",
        };

        var rows = new List<(string Name, int Count, string Shape)>();

        foreach (var (hash, count) in shapeA) {
            rows.Add((known.GetValueOrDefault(hash) ?? $"<unresolved {hash}>", count, "A"));
        }

        foreach (var (hash, count) in shapeB) {
            rows.Add((known.GetValueOrDefault(hash) ?? $"<unresolved {hash}>", count, "B"));
        }

        rows.Sort((left, right) => right.Count != left.Count
            ? right.Count - left.Count
            : string.CompareOrdinal(left.Name, right.Name));

        foreach (var (name, count, shape) in rows) {
            lines.Add($"{name.PadRight(36)} {count.ToString(CultureInfo.InvariantCulture).PadLeft(6)}  {shape}");
        }

        Console.Out.Write(string.Join('\n', lines) + "\n");

        if (known.Count == 0) {
            Console.Error.WriteLine(
                "note: no --classes given — shape B (a bare class hash) cannot be recognised, "
                + "so its entries are not counted.");
        }

        foreach (var error in errors) {
            Console.Error.WriteLine($"error: {error}");
        }

        if (options.Json is not null) {
            WriteJson(options.Json, wads.Count, errors, shapeA, shapeB, known, aCount, bCount);
        }

        return 0;
    }

    private static void WriteJson(
        string path,
        int wads,
        List<string> errors,
        Dictionary<uint, int> shapeA,
        Dictionary<uint, int> shapeB,
        IReadOnlyDictionary<uint, string> known,
        int aCount,
        int bCount) {
        var payload = new Dictionary<string, object> {
            ["wads"] = wads,
            ["parseErrors"] = errors,
            ["shapeA"] = Named(shapeA, known),
            ["shapeB"] = Named(shapeB, known),
            ["shapeACount"] = aCount,
            ["shapeBCount"] = bCount,
            ["total"] = aCount + bCount,
            ["classes"] = shapeA.Count + shapeB.Count,
        };

        File.WriteAllText(path, JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = true }));
    }

    private static Dictionary<string, int> Named(
        Dictionary<uint, int> counts,
        IReadOnlyDictionary<uint, string> known) {
        var named = new Dictionary<string, int>();

        foreach (var (hash, count) in counts) {
            named[known.GetValueOrDefault(hash) ?? $"<unresolved {hash}>"] = count;
        }

        return named;
    }

    private static void Bump(Dictionary<uint, int> counts, uint hash)
        => counts[hash] = counts.GetValueOrDefault(hash) + 1;

    /// <summary>Shape A: `BINd` + flags(4) + class hash(4).</summary>
    private static uint? ClassHashShapeA(byte[] payload) {
        if (payload.Length < WadFile.HeaderBytes) {
            return null;
        }

        return payload[0] == 'B' && payload[1] == 'I' && payload[2] == 'N' && payload[3] == 'd'
            ? BitConverter.ToUInt32(payload, 8)
            : null;
    }

    /// <summary>Shape B: a bare class hash at offset 0 that the class table knows.</summary>
    private static uint? ClassHashShapeB(byte[] payload, IReadOnlyDictionary<uint, string> known) {
        if (payload.Length < 8) {
            return null;
        }

        var hash = BitConverter.ToUInt32(payload, 0);

        return known.ContainsKey(hash) ? hash : null;
    }
}

/// <summary>
/// `ClientDump.json` (Imcodec's WizWalker type dump): hash → class name, for the census's table and
/// for shape-B recognition. Read-only; the file lives in the Imview checkout and is never written.
/// </summary>
internal static class ClassNames {

    /// <summary>`hash → name`, or an empty map when no `--classes` was given.</summary>
    public static Dictionary<uint, string> Load(string? path) {
        var names = new Dictionary<uint, string>();

        if (string.IsNullOrEmpty(path)) {
            return names;
        }

        if (!File.Exists(path)) {
            throw new UsageException($"--classes file not found: {path}");
        }

        using var document = JsonDocument.Parse(File.ReadAllBytes(path));
        var classes = document.RootElement.GetProperty("classes");

        foreach (var property in classes.EnumerateObject()) {
            var value = property.Value;

            if (!value.TryGetProperty("hash", out var hashElement) || !hashElement.TryGetUInt32(out var hash)) {
                continue;
            }

            var name = value.TryGetProperty("name", out var nameElement)
                ? nameElement.GetString() ?? property.Name
                : property.Name;

            names[hash] = name.StartsWith("class ", StringComparison.Ordinal) ? name[6..] : name;
        }

        return names;
    }
}