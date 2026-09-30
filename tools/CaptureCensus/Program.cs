using System.Text;
using System.Text.Json;

namespace CaptureCensus;

/// <summary>
/// Reads a packet capture (the input <c>imview-packet-reader</c> consumes) and reports, for every
/// message type and field the capture carries, how many messages carry it and whether the reader
/// consumes it (Phase 7 task 7.2, decisions D128/D139).
///
/// The output is byte-stable so it can be committed as a golden: rows are sorted by message and then
/// by field (ordinal), the input is named by its file name only, and the JSON is indented with "\n"
/// and ends with one newline.
/// </summary>
internal static class Program {

    private const string Usage = """
        Usage: capture-census --input <path> [--output <path|->]

        Lists every message type and field a packet capture carries, with the number of messages that
        carry it and whether the reader (Imview's QuestBuilder plus the imview-packet-reader wrapper)
        consumes it.

        Options:
          --input  <path>    Packet capture file to read (required).
          --output <path|->  Write the JSON here; "-" or omitted writes to stdout.
          -h, --help         Show this help and exit.

        Output: {"input": <file name>, "messages": <envelope count>,
                 "rows": [{"message", "field", "count", "consumed"}, ...]}

        Exit codes: 0 = success, 1 = error (message on stderr).
        """;

    /// <summary>
    /// THE consumed-fields table: for each message type, the fields the reader reads today. A field
    /// of a listed message that is not here, and every field of an unlisted message, is reported
    /// <c>consumed: false</c>. Story 7.3/7.4 flip an entry to consumed in the same change that teaches
    /// the wrapper the field, then regenerate the committed census goldens.
    ///
    /// Derived from Imview/src/Imview.PacketReader/QuestBuilder.cs (QB), tools/PacketReaderCli/Program.cs
    /// (CLI) and the task 7.3 observed-field post-pass tools/PacketReaderCli/ObservedFields.cs (OF):
    ///   MSG_QUESTOFFER   MobileID QB:88; QuestName QB:79 + CLI:182; QuestTitle QB:80 + OF:90; Level CLI:183
    ///                    (QB:81 reads it but always gets 0, D46); Mainline QB:82; GoalData QB:183;
    ///                    QuestInfo OF:96. Rewards is declared by QuestOfferPacket but never read.
    ///   MSG_SENDQUEST    QuestID QB:109 + OF:56,88; QuestTitle QB:108 + OF:56; QuestInfo OF:96;
    ///                    QuestNameID OF:98; NoQuestHelper OF:100; SkipQHAutoSelect OF:102; ActivityType
    ///                    OF:104; ClientTags OF:106; PetOnlyQuest OF:110 (read and reported on stderr: the
    ///                    quest schema has no home for it). Rewards is not read (task 7.5).
    ///   MSG_SENDGOAL     QuestID QB:124 + OF:125; GoalID QB:176 + OF:132; GoalNameID QB:126,134 + OF:132;
    ///                    GoalTitle QB:130,135; GoalLocation QB:136; GoalDestinationZone QB:137; GoalImage1
    ///                    QB:138; GoalImage2 QB:139; GoalType QB:132,140; GoalTotal QB:143,148; UseTally
    ///                    QB:147,154; GoalMadlibs QB:147-148; ClientTags QB:159-165; PersonaName OF:167;
    ///                    NoQuestHelper OF:170; PetOnlyQuest OF:172.
    ///   MSG_ACTORDIALOG  MobileID QB:242; QuestID QB:312; GoalID QB:371; CompletionType QB:243,311,396;
    ///                    ActorDialog QB:246,315,374; Persona QB:271,340,408. PersonaName, PersonaIcon,
    ///                    RangeCheck, IsEncounter and DefaultDialogAnimation are declared, never read.
    ///   MSG_COMPLETEGOAL GoalID OF:75,163; CompleteText OF:174.
    ///   MSG_PERSONAINFO  GoalID OF:75,164; GoalHyperlink OF:176.
    ///   MSG_COMPLETEQUEST QuestID OF:115; CompleteText OF:116 (read and reported on stderr: nothing shows
    ///                    it is the string-table key m_questComplete holds).
    ///   every other message (MSG_REMOVEGOAL, ...) has no reader, so nothing in it is read.
    /// </summary>
    private static readonly Dictionary<string, HashSet<string>> s_consumed = new(StringComparer.Ordinal) {
        ["MSG_QUESTOFFER"] = ["MobileID", "QuestName", "QuestTitle", "Level", "Mainline", "GoalData", "QuestInfo"],
        ["MSG_SENDQUEST"] = [
            "QuestID", "QuestTitle", "QuestInfo", "QuestNameID", "NoQuestHelper", "SkipQHAutoSelect",
            "ActivityType", "ClientTags", "PetOnlyQuest",
        ],
        ["MSG_SENDGOAL"] = [
            "QuestID", "GoalID", "GoalNameID", "GoalTitle", "GoalLocation", "GoalDestinationZone",
            "GoalImage1", "GoalImage2", "GoalType", "GoalTotal", "UseTally", "GoalMadlibs", "ClientTags",
            "PersonaName", "NoQuestHelper", "PetOnlyQuest",
        ],
        ["MSG_ACTORDIALOG"] = ["MobileID", "QuestID", "GoalID", "CompletionType", "ActorDialog", "Persona"],
        ["MSG_COMPLETEGOAL"] = ["GoalID", "CompleteText"],
        ["MSG_PERSONAINFO"] = ["GoalID", "GoalHyperlink"],
        ["MSG_COMPLETEQUEST"] = ["QuestID", "CompleteText"],
    };

    private static int Main(string[] args) {
        string? input = null;
        string? output = null;

        for (var i = 0; i < args.Length; i++) {
            switch (args[i]) {
                case "-h" or "--help":
                    Console.Out.WriteLine(Usage);
                    return 0;

                case "--input" when i + 1 < args.Length:
                    input = args[++i];
                    break;

                case "--output" when i + 1 < args.Length:
                    output = args[++i];
                    break;

                default:
                    return Fail($"unknown or incomplete argument: {args[i]}", withUsage: true);
            }
        }

        if (input is null) {
            return Fail("missing required argument: --input <path>", withUsage: true);
        }

        try {
            var json = Render(input);

            if (output is null or "-") {
                Console.Out.Write(json);
            }
            else {
                var fullPath = Path.GetFullPath(output);
                var directory = Path.GetDirectoryName(fullPath);

                if (!string.IsNullOrEmpty(directory)) {
                    Directory.CreateDirectory(directory);
                }

                File.WriteAllText(fullPath, json);
            }

            return 0;
        }
        catch (Exception ex) when (ex is CensusException or IOException or UnauthorizedAccessException or JsonException) {
            return Fail(ex.Message, withUsage: false);
        }
    }

    private static string Render(string path) {
        if (!File.Exists(path)) {
            throw new CensusException($"input file not found: {path}");
        }

        using var document = JsonDocument.Parse(File.ReadAllText(path));
        var envelopes = document.RootElement.ValueKind switch {
            JsonValueKind.Array => document.RootElement.EnumerateArray().ToList(),
            JsonValueKind.Object => [document.RootElement],
            _ => throw new CensusException($"'{path}' is not a packet capture: expected a JSON array (or object) of envelopes"),
        };

        var counts = new SortedDictionary<(string Message, string Field), int>(
            Comparer<(string Message, string Field)>.Create((a, b) => {
                var byMessage = string.CompareOrdinal(a.Message, b.Message);
                return byMessage != 0 ? byMessage : string.CompareOrdinal(a.Field, b.Field);
            }));

        foreach (var envelope in envelopes) {
            if (envelope.ValueKind != JsonValueKind.Object
                || !envelope.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object
                || !data.TryGetProperty("name", out var name) || name.ValueKind != JsonValueKind.String
                || string.IsNullOrEmpty(name.GetString())
                || !data.TryGetProperty("fields", out var fields) || fields.ValueKind != JsonValueKind.Object) {
                throw new CensusException(
                    $"'{path}' is not a packet capture: every entry must look like "
                    + "{\"data\":{\"name\":\"MSG_…\",\"fields\":{…}}}");
            }

            var message = name.GetString()!;

            // Object property names are unique per object in every capture we write; a duplicate name
            // would be counted once, which is what "messages that carry the field" means.
            foreach (var field in fields.EnumerateObject().Select(f => f.Name).Distinct(StringComparer.Ordinal)) {
                counts[(message, field)] = counts.GetValueOrDefault((message, field)) + 1;
            }
        }

        var stream = new MemoryStream();

        using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Indented = true, NewLine = "\n" })) {
            writer.WriteStartObject();
            writer.WriteString("input", Path.GetFileName(path));
            writer.WriteNumber("messages", envelopes.Count);
            writer.WriteStartArray("rows");

            foreach (var ((message, field), count) in counts) {
                writer.WriteStartObject();
                writer.WriteString("message", message);
                writer.WriteString("field", field);
                writer.WriteNumber("count", count);
                writer.WriteBoolean("consumed", s_consumed.TryGetValue(message, out var set) && set.Contains(field));
                writer.WriteEndObject();
            }

            writer.WriteEndArray();
            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(stream.ToArray()) + "\n";
    }

    private static int Fail(string message, bool withUsage) {
        Console.Error.WriteLine(message.StartsWith("error", StringComparison.Ordinal) ? message : $"error: {message}");

        if (withUsage) {
            Console.Error.WriteLine();
            Console.Error.WriteLine(Usage);
        }

        return 1;
    }

    private sealed class CensusException(string message) : Exception(message);

}
