using System.Text.Json;
using System.Text.Json.Nodes;
using Imcodec.ObjectProperty.TypeCache;
using Imview.PacketReader;
using Newtonsoft.Json;

namespace PacketReaderCli;

/// <summary>
/// CLI wrapper around <see cref="QuestBuilder"/>: reads a JSON packet capture and writes the
/// reconstructed quests as a JSON array. Everything except the JSON payload goes to stderr, so
/// the Node caller can <c>JSON.parse</c> stdout directly.
/// </summary>
internal static class Program {

    private const string Usage = """
        Usage: imview-packet-reader --input <path> [--output <path|->]

        Reconstructs QuestTemplate objects from a JSON packet capture file.

        Options:
          --input  <path>    Packet capture file to read (required).
          --output <path|->  Write the JSON here; "-" or omitted writes to stdout.
          -h, --help         Show this help and exit.

        Output is a JSON array of QuestTemplate objects. A capture that parses but
        contains no quest packets is a valid empty result: exit 0 with [].

        The wrapper restores MSG_QUESTOFFER.Level, which the bundled reader drops
        (decision D46), and keeps the reader's diagnostics off stdout.

        Exit codes: 0 = success, 1 = error (message on stderr).
        """;

    // Canonical settings used by the game server (Imlight SpiralDB.cs L48-51): the corpus and
    // review JSON format relies on $type annotations and omits null fields.
    private static readonly JsonSerializerSettings s_jsonSettings = new() {
        TypeNameHandling = TypeNameHandling.Auto,
        NullValueHandling = NullValueHandling.Ignore
    };

    private static async Task<int> Main(string[] args) {
        if (!TryParseArguments(args, out var options, out var argumentError)) {
            Console.Error.WriteLine(argumentError);
            Console.Error.WriteLine();
            Console.Error.WriteLine(Usage);
            return 1;
        }

        if (options.Help) {
            Console.Out.WriteLine(Usage);
            return 0;
        }

        try {
            // Validate before handing the path to the builder: the builder silently returns an
            // empty list for anything it cannot match, so a non-capture would look like success.
            var levels = ValidateCapture(options.InputPath);

            // The upstream builder writes diagnostics straight to Console.Out (a template-manifest
            // warning fires as soon as a dialog carries a persona), which would corrupt the JSON
            // payload the Node caller parses. Keep its chatter off stdout for the call.
            List<QuestTemplate> quests;
            var stdout = Console.Out;
            try {
                Console.SetOut(Console.Error);
                quests = await QuestBuilder.BuildQuestsFromPacketCaptureAsync(options.InputPath);
            }
            finally {
                Console.SetOut(stdout);
            }

            ApplyOfferLevels(quests, levels);
            var json = JsonConvert.SerializeObject(quests, Formatting.Indented, s_jsonSettings);

            if (options.OutputPath is null or "-") {
                Console.Out.Write(json);
            }
            else {
                var fullPath = Path.GetFullPath(options.OutputPath);
                var directory = Path.GetDirectoryName(fullPath);
                if (!string.IsNullOrEmpty(directory)) {
                    Directory.CreateDirectory(directory);
                }

                await File.WriteAllTextAsync(fullPath, json);
            }

            return 0;
        }
        catch (Exception ex) {
            Console.Error.WriteLine($"error: {Describe(ex)}");
            return 1;
        }
    }

    private sealed record Options(string InputPath, string? OutputPath, bool Help);

    /// <summary>
    /// Reads and validates the capture file, throwing <see cref="CliException"/> with a
    /// user-facing message when it is missing, unreadable, not JSON, or not a packet capture.
    /// </summary>
    private static Dictionary<string, int> ValidateCapture(string path) {
        if (!File.Exists(path)) {
            throw new CliException($"input file not found: {path}");
        }

        string text;
        try {
            text = File.ReadAllText(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) {
            throw new CliException($"cannot read input file '{path}': {ex.Message}");
        }

        JsonNode? root;
        try {
            root = JsonNode.Parse(text);
        }
        catch (System.Text.Json.JsonException ex) {
            throw new CliException($"'{path}' is not valid JSON: {ex.Message}");
        }

        if (root is null || !LooksLikePacketCapture(root)) {
            throw new CliException(
                $"'{path}' is not a packet capture. Expected a JSON array (or a single object) of " +
                "envelopes shaped like {\"data\":{\"name\":\"MSG_QUESTOFFER\",\"fields\":{...}}}."
            );
        }

        return ReadOfferLevels(root);
    }

    // An empty array is a valid capture with no packets; every entry must otherwise be an
    // envelope carrying a packet name and a fields object, mirroring PacketReaderService.
    private static bool LooksLikePacketCapture(JsonNode root) => root switch {
        JsonArray array => array.All(IsEnvelope),
        JsonObject packet => IsEnvelope(packet),
        _ => false
    };

    private static bool IsEnvelope(JsonNode? node)
        => node is JsonObject packet
            && packet["data"] is JsonObject data
            && data["name"] is JsonValue name
            && name.TryGetValue<string>(out var packetName)
            && !string.IsNullOrEmpty(packetName)
            && data["fields"] is JsonObject;

    /// <summary>
    /// Collects the <c>MSG_QUESTOFFER</c> quest-name → level pairs. The bundled reader cannot
    /// recover this field (decision D46): it reads the node through
    /// <c>GetValue&lt;object&gt;()</c> + <c>Convert.ChangeType</c>, which throws for a JSON
    /// number and is swallowed into <c>default(int)</c>, so every extracted quest would claim
    /// level 0 — including on save. The wrapper restores it from the same capture it validated.
    /// </summary>
    private static Dictionary<string, int> ReadOfferLevels(JsonNode root) {
        var levels = new Dictionary<string, int>(StringComparer.Ordinal);

        foreach (var packet in Envelopes(root)) {
            var fields = packet?["data"]?["fields"];
            if (packet?["data"]?["name"]?.GetValue<string>() != "MSG_QUESTOFFER" || fields is null) {
                continue;
            }

            var questName = ReadFieldString(fields["QuestName"]);
            if (!string.IsNullOrEmpty(questName) && ReadFieldInt(fields["Level"]) is { } level) {
                levels[questName] = level;
            }
        }

        return levels;
    }

    private static IEnumerable<JsonNode?> Envelopes(JsonNode root)
        => root is JsonArray array ? array : [root];

    private static string? ReadFieldString(JsonNode? field)
        => field?["value"] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;

    private static int? ReadFieldInt(JsonNode? field) {
        if (field?["value"] is not JsonValue value) {
            return null;
        }

        if (value.TryGetValue<int>(out var number)) {
            return number;
        }

        // Tolerate a capture that wrote the level as a float (e.g. 1.0).
        return value.TryGetValue<double>(out var floating) && floating % 1 == 0
            ? (int) floating
            : null;
    }

    /// <summary>Applies the levels read from the capture to the extracted quests (see D46).</summary>
    private static void ApplyOfferLevels(List<QuestTemplate> quests, Dictionary<string, int> levels) {
        foreach (var quest in quests) {
            if (quest.m_questName is not null && levels.TryGetValue(quest.m_questName, out var level)) {
                quest.m_questLevel = level;
            }
        }
    }

    private static bool TryParseArguments(string[] args, out Options options, out string error) {
        options = new Options(string.Empty, null, false);
        error = string.Empty;

        string? inputPath = null;
        string? outputPath = null;

        for (var i = 0; i < args.Length; i++) {
            var argument = args[i];

            switch (argument) {
                case "-h" or "--help":
                    options = new Options(string.Empty, null, true);
                    return true;

                case "--input":
                    if (!TryTakeValue(args, ref i, argument, out var inputValue, out error)) {
                        return false;
                    }

                    inputPath = inputValue;
                    break;

                case "--output":
                    if (!TryTakeValue(args, ref i, argument, out var outputValue, out error)) {
                        return false;
                    }

                    outputPath = outputValue;
                    break;

                default:
                    error = $"unknown argument: {argument}";
                    return false;
            }
        }

        if (inputPath is null) {
            error = "missing required argument: --input <path>";
            return false;
        }

        options = new Options(inputPath, outputPath, false);
        return true;
    }

    private static bool TryTakeValue(
        string[] args, ref int index, string flag, out string value, out string error) {

        if (index + 1 >= args.Length) {
            value = string.Empty;
            error = $"missing value for {flag}";
            return false;
        }

        index++;
        value = args[index];
        error = string.Empty;
        return true;
    }

    /// <summary>Flattens a message chain so the underlying cause is never lost.</summary>
    private static string Describe(Exception exception) {
        var messages = new List<string>();

        for (var current = exception; current is not null; current = current.InnerException) {
            if (!string.IsNullOrWhiteSpace(current.Message) && !messages.Contains(current.Message)) {
                messages.Add(current.Message);
            }
        }

        return string.Join(" -> ", messages);
    }

    private sealed class CliException(string message) : Exception(message);

}