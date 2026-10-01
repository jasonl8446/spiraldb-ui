using System.Text.Json;
using System.Text.Json.Nodes;
using Imcodec.ObjectProperty.TypeCache;
using Imview.PacketReader;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace PacketReaderCli;

/// <summary>
/// CLI wrapper around <see cref="QuestBuilder"/>: reads a JSON packet capture and writes the
/// reconstructed quests as a JSON array. Everything except the JSON payload goes to stderr, so
/// the Node caller can <c>JSON.parse</c> stdout directly.
/// </summary>
internal static class Program {

    private const string Usage = """
        Usage: imview-packet-reader --input <path> [--output <path|->] [--suggestions <path>]

        Reconstructs QuestTemplate objects from a JSON packet capture file.

        Options:
          --input  <path>    Packet capture file to read (required).
          --output <path|->  Write the JSON here; "-" or omitted writes to stdout.
          --suggestions <path>
                             Also write the inferred values to this file (task 7.5).
          -h, --help         Show this help and exit.

        Output is a JSON array of QuestTemplate objects. A capture that parses but
        contains no quest packets is a valid empty result: exit 0 with [].

        The wrapper restores MSG_QUESTOFFER.Level, which the bundled reader drops
        (decision D46), and keeps the reader's diagnostics off stdout.

        It repairs three reader defects (task 7.4): the quest's Prep/Completion dialog
        is taken from a GoalID-0 packet; an ACHIEVERANK goal the reader drops as a
        duplicate GoalNameID is added back, named {n}_{GoalTitle} by position; a goal
        type QuestBuilder does not list is excluded and the capture re-read. Dialogs
        reach goals the reader did not map by GoalID; quest-level Underway dialogs and
        MSG_ENCOUNTERDIALOG become dialog blocks. Each change is reported on stderr
        as {"report":"reader-repair"|"goal-excluded",...}.

        It also copies the observed fields the reader drops (Phase 7, D126/D127):
        MSG_SENDQUEST QuestInfo/QuestNameID/NoQuestHelper/SkipQHAutoSelect/
        ActivityType/ClientTags, MSG_SENDGOAL PersonaName/NoQuestHelper/PetOnlyQuest,
        MSG_COMPLETEGOAL CompleteText and MSG_PERSONAINFO GoalHyperlink, joined by
        QuestID/GoalID. A value it cannot write is reported on stderr as one JSON
        line {"report":"observed-field","quest","path","source","value","reason"}.

        With --suggestions it writes {"suggestions":[{questName,path,value,source,
        confidence,note}]} to that file (D138): m_startGoals and m_goalLogic chains
        from packet order (complete, remove, send on one QuestID; MSG_COMPLETEQUEST
        marks the terminal goal) and the reward packets (Rewards, MSG_QUESTREWARDS,
        MSG_LOOT) as rolled observations at m_endResults.m_results. Nothing in it is
        merged into the templates; stdout is the same array with or without the flag.
        A value it cannot suggest is reported as {"report":"suggestion",...}.

        Exit codes: 0 = success, 1 = error (message on stderr).
        """;

    // Canonical settings used by the game server (Imlight SpiralDB.cs L48-51): the corpus and
    // review JSON format relies on $type annotations and omits null fields.
    // D48: the corpus writes every enum-valued field as its NAME (m_goalType x772,
    // m_operator x673, m_activityType x322, ...), so the extraction output must too -
    // otherwise every quest we save rewrites those fields as integers and the diff is
    // noise. The game server's own settings (Imlight SpiralDB.cs) omit this converter
    // but Newtonsoft reads both forms, so names stay loadable.
    private static readonly JsonSerializerSettings s_jsonSettings = new() {
        TypeNameHandling = TypeNameHandling.Auto,
        NullValueHandling = NullValueHandling.Ignore,
        Converters = { new StringEnumConverter() }
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
            var capture = ValidateCapture(options.InputPath);

            var (quests, read) = await BuildExcludingUnlistedGoals(options.InputPath, capture, Console.Error.WriteLine);

            ApplyOfferLevels(quests, ReadOfferLevels(read));
            var goals = ReaderRepairs.JoinGoals(quests, read, Console.Error.WriteLine);
            ReaderRepairs.RepairDialogs(quests, read, goals, Console.Error.WriteLine);
            ObservedFields.Apply(quests, read, goals.ById, Console.Error.WriteLine);

            // Inferred values go to the sidecar only (D127/D138); the templates are not touched.
            if (options.SuggestionsPath is not null) {
                var suggestions = Suggestions.Infer(quests, capture, goals.ById, Console.Error.WriteLine);
                await WriteFile(options.SuggestionsPath,
                    new JsonObject { ["suggestions"] = suggestions }.ToJsonString(s_sidecarOptions));
            }

            var json = JsonConvert.SerializeObject(quests, Formatting.Indented, s_jsonSettings);

            if (options.OutputPath is null or "-") {
                Console.Out.Write(json);
            }
            else {
                await WriteFile(options.OutputPath, json);
            }

            return 0;
        }
        catch (Exception ex) {
            Console.Error.WriteLine($"error: {Describe(ex)}");
            return 1;
        }
    }

    private sealed record Options(string InputPath, string? OutputPath, string? SuggestionsPath, bool Help);

    // The sidecar is System.Text.Json (it is built from JsonNodes); the relaxed encoder keeps notes readable.
    private static readonly JsonSerializerOptions s_sidecarOptions = new() {
        WriteIndented = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>Writes <paramref name="contents"/> to <paramref name="path"/>, creating parent directories.</summary>
    private static async Task WriteFile(string path, string contents) {
        var fullPath = Path.GetFullPath(path);
        var directory = Path.GetDirectoryName(fullPath);
        if (!string.IsNullOrEmpty(directory)) {
            Directory.CreateDirectory(directory);
        }

        await File.WriteAllTextAsync(fullPath, contents);
    }

    private const string UnsupportedGoalType = "Unsupported goal type: ";

    /// <summary>
    /// Runs QuestBuilder; when it throws on a goal type its <c>GetGoalFromType</c> does not list
    /// (QuestBuilder.cs:484-494), re-runs it on a copy of the capture without that goal (task 7.4): every
    /// <c>MSG_SENDGOAL</c> of that type, and every message carrying one of their <c>GoalID</c>s, is left
    /// out and reported as one <c>{"report":"goal-excluded", …}</c> line. Returns the quests and the capture
    /// they were read from, which the post-passes then read. A compilation goal of an unlisted type (inside
    /// <c>MSG_QUESTOFFER.GoalData</c>) is not excluded; that throw still fails the run.
    /// </summary>
    private static async Task<(List<QuestTemplate> Quests, JsonNode Read)> BuildExcludingUnlistedGoals(
        string inputPath, JsonNode capture, Action<string> report) {
        var read = capture;
        string? scratch = null;

        try {
            while (true) {
                try {
                    return (await BuildQuests(scratch ?? inputPath), read);
                }
                catch (NotSupportedException ex) when (ex.Message.StartsWith(UnsupportedGoalType, StringComparison.Ordinal)
                    && Enum.TryParse<GOAL_TYPE>(ex.Message[UnsupportedGoalType.Length..], out var goalType)
                    && ExcludeGoalType(read, goalType, report) is { } filtered) {
                    read = filtered;
                    scratch ??= Path.Combine(Path.GetTempPath(), $"imview-packet-reader-{Guid.NewGuid():N}.json");
                    await File.WriteAllTextAsync(scratch, read.ToJsonString());
                }
            }
        }
        finally {
            if (scratch is not null) {
                File.Delete(scratch);
            }
        }
    }

    private static async Task<List<QuestTemplate>> BuildQuests(string path) {
        // The upstream builder writes diagnostics straight to Console.Out (a template-manifest
        // warning fires as soon as a dialog carries a persona), which would corrupt the JSON
        // payload the Node caller parses. Keep its chatter off stdout for the call.
        var stdout = Console.Out;
        try {
            Console.SetOut(Console.Error);
            return await QuestBuilder.BuildQuestsFromPacketCaptureAsync(path);
        }
        finally {
            Console.SetOut(stdout);
        }
    }

    /// <summary>The capture without the goals of <paramref name="goalType"/>, or null when it has none.</summary>
    private static JsonNode? ExcludeGoalType(JsonNode root, GOAL_TYPE goalType, Action<string> report) {
        var envelopes = ObservedFields.Envelopes(root);
        var excluded = ObservedFields.Named(envelopes, "MSG_SENDGOAL")
            .Where(p => ObservedFields.ReadInteger(p["GoalType"]?["value"]) == (int) goalType)
            .ToList();
        var goalIds = excluded.Select(p => ObservedFields.ReadId(p, "GoalID")).OfType<ulong>().ToHashSet();
        if (goalIds.Count == 0) {
            return null;
        }

        var kept = new JsonArray();
        var dropped = new Dictionary<ulong, int>();
        foreach (var (node, envelope) in (root is JsonArray array ? array : [root]).Zip(envelopes)) {
            if (ObservedFields.ReadId(envelope.Fields, "GoalID") is { } goalId && goalIds.Contains(goalId)) {
                dropped[goalId] = dropped.GetValueOrDefault(goalId) + 1;
                continue;
            }

            kept.Add(node!.DeepClone());
        }

        // Name the quest through the same joins QuestBuilder uses: QuestID -> MSG_SENDQUEST title -> offer.
        var titleById = ObservedFields.Named(envelopes, "MSG_SENDQUEST")
            .Select(p => (Id: ObservedFields.ReadId(p, "QuestID"), Title: ObservedFields.ReadString(p, "QuestTitle")))
            .Where(q => q.Id is not null && q.Title is not null)
            .GroupBy(q => q.Id!.Value).ToDictionary(g => g.Key, g => g.First().Title!);
        var nameByTitle = ObservedFields.Named(envelopes, "MSG_QUESTOFFER")
            .Select(p => (Title: ObservedFields.ReadString(p, "QuestTitle"), Name: ObservedFields.ReadString(p, "QuestName")))
            .Where(q => q.Title is not null && q.Name is not null)
            .GroupBy(q => q.Title!).ToDictionary(g => g.Key, g => g.First().Name!);

        foreach (var goalId in goalIds) {
            var packet = excluded.First(p => ObservedFields.ReadId(p, "GoalID") == goalId);
            var quest = ObservedFields.ReadId(packet, "QuestID") is { } questId && titleById.TryGetValue(questId, out var title)
                ? nameByTitle.GetValueOrDefault(title, "")
                : "";
            ObservedFields.Report(report, quest, $"m_goals[GoalID {goalId}]", "MSG_SENDGOAL.GoalType",
                packet["GoalType"]?["value"],
                $"{goalType} is not listed by QuestBuilder.GetGoalFromType, which throws NotSupportedException "
                + $"for it; re-read without this goal ({dropped[goalId]} message(s) carrying its GoalID)",
                "goal-excluded");
        }

        return kept;
    }

    /// <summary>
    /// Reads and validates the capture file, throwing <see cref="CliException"/> with a
    /// user-facing message when it is missing, unreadable, not JSON, or not a packet capture.
    /// Returns the parsed capture, which the post-passes (D46 levels, Phase 7 observed fields) re-read.
    /// </summary>
    private static JsonNode ValidateCapture(string path) {
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

        return root;
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
        options = new Options(string.Empty, null, null, false);
        error = string.Empty;

        string? inputPath = null;
        string? outputPath = null;
        string? suggestionsPath = null;

        for (var i = 0; i < args.Length; i++) {
            var argument = args[i];

            switch (argument) {
                case "-h" or "--help":
                    options = new Options(string.Empty, null, null, true);
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

                case "--suggestions":
                    if (!TryTakeValue(args, ref i, argument, out var suggestionsValue, out error)) {
                        return false;
                    }

                    suggestionsPath = suggestionsValue;
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

        options = new Options(inputPath, outputPath, suggestionsPath, false);
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