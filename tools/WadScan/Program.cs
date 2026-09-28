namespace WadScan;

/// <summary>The parsed command line. `Select` holds the `--select` globs, in the order given.</summary>
internal sealed class Options {
    public string? Gamedata { get; set; }
    public string? Classes { get; set; }
    public string? Out { get; set; }
    public string? Json { get; set; }
    public bool Help { get; set; }
    public List<string> Select { get; } = [];
}

/// <summary>A bad command line — reported with the usage text, exit code 1.</summary>
internal sealed class UsageException(string message) : Exception(message);

/// <summary>
/// `wad-scan` — the batch WAD object reader (task 6.2,
/// [plan-phase-6-quest-catalog.md](../../docs/plan-phase-6-quest-catalog.md) L212–225).
///
/// Two commands, one tree walk each:
///
///  * `census`  — classify every entry in the tree by class hash at its fixed header offset and
///    print the class table (both container shapes). Index-only: it never inflates more than a
///    12-byte header's worth per entry.
///  * `extract` — deserialize the entries matching `--select` with `BindSerializer` and write one
///    compact NDJSON row per entry.
///
/// It exists because the shipped `imcodec` CLI has no batch mode: one process per file, measured at
/// **78 s per 400 files** (≈22 min for the 6,733 zone-data files that Phase 6 depends on). Both
/// commands share `WadFile`'s index-first reads, so the whole tree costs one index pass.
///
/// Everything except the census report and (optionally) its JSON goes to stderr; `extract` writes
/// nothing to stdout at all, so `--out` is the only data channel.
/// </summary>
internal static class Program {

    private const string Usage = """
        Usage: wad-scan <command> [options]

        Commands:
          census   --gamedata <dir> [--classes <ClientDump.json>] [--json <path>]
          extract  --gamedata <dir> --select <glob,glob> --out <ndjson>

        Options:
          --gamedata <dir>   Directory tree holding the *.wad archives (required, both commands).
          --classes <path>   Imcodec ClientDump.json: resolves class hashes to names and enables
                             shape-B (bare class hash) recognition. Census only.
          --json <path>      Write the census result as JSON (wads, shapeA, shapeB, parseErrors).
          --select <globs>   Comma-separated entry-name globs. The FULL stored entry name is matched
                             case-sensitively; `*` and `?` stop at '/', `**` crosses it, so a nested
                             path needs `**` (a bare `gamedata.bin` selects the flat entries).
          --out <path>       NDJSON file: one compact row per selected entry (extract). A row for an
                             entry that could not be deserialized carries `error` instead of
                             `class`/`object`; the row count is always the selection's.
          -h, --help         Show this help and exit.

        Exit codes: 0 = the command ran (the census/selection counts are in its output),
                    1 = usage error, an unreadable tree, or a command that threw.
        """;

    private static int Main(string[] args) {
        if (args.Length == 0) {
            Console.Error.WriteLine(Usage);

            return 1;
        }

        var command = args[0];

        try {
            if (command is "-h" or "--help") {
                Console.Error.WriteLine(Usage);

                return 0;
            }

            var options = ParseArguments(args[1..]);

            if (options.Help) {
                Console.Error.WriteLine(Usage);

                return 0;
            }

            return command switch {
                "census" => Census.Run(options),
                "extract" => Extract.Run(options),
                _ => throw new UsageException($"unknown command: {command}"),
            };
        }
        catch (UsageException exception) {
            Console.Error.WriteLine($"error: {exception.Message}");
            Console.Error.WriteLine();
            Console.Error.WriteLine(Usage);

            return 1;
        }
        catch (Exception exception) {
            // Anything unexpected (an unreadable tree, a bad ClientDump, …) is reported instead of
            // half-written output.
            Console.Error.WriteLine($"error: {Describe(exception)}");

            return 1;
        }
    }

    private static Options ParseArguments(string[] args) {
        var options = new Options();

        for (var i = 0; i < args.Length; i++) {
            switch (args[i]) {
                case "-h" or "--help":
                    options.Help = true;
                    break;

                case "--gamedata":
                    options.Gamedata = TakeValue(args, ref i, args[i]);
                    break;

                case "--classes":
                    options.Classes = TakeValue(args, ref i, args[i]);
                    break;

                case "--out":
                    options.Out = TakeValue(args, ref i, args[i]);
                    break;

                case "--json":
                    options.Json = TakeValue(args, ref i, args[i]);
                    break;

                case "--select":
                    options.Select.AddRange(
                        TakeValue(args, ref i, args[i])
                            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
                    break;

                default:
                    throw new UsageException($"unknown argument: {args[i]}");
            }
        }

        return options;
    }

    private static string TakeValue(string[] args, ref int index, string flag) {
        if (index + 1 >= args.Length) {
            throw new UsageException($"missing value for {flag}");
        }

        index++;

        return args[index];
    }

    /// <summary>
    /// Every distinct message down the exception chain — an `AggregateException`-free, one-line
    /// form of what went wrong (the same reporting `tools/FixtureGen` uses).
    /// </summary>
    internal static string Describe(Exception exception) {
        var messages = new List<string>();

        for (var current = exception; current is not null; current = current.InnerException) {
            if (!string.IsNullOrWhiteSpace(current.Message) && !messages.Contains(current.Message)) {
                messages.Add(current.Message);
            }
        }

        return string.Join(" -> ", messages);
    }
}