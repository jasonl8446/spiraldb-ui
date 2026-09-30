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
    /// (CLI), the task 7.3 observed-field post-pass tools/PacketReaderCli/ObservedFields.cs (OF) and the
    /// task 7.4 reader repairs tools/PacketReaderCli/ReaderRepairs.cs (RR) and the task 7.5 suggestions
    /// tools/PacketReaderCli/Suggestions.cs (SG, read under --suggestions):
    ///   MSG_QUESTOFFER   MobileID QB:88 + RR:143; QuestName QB:79 + CLI:278 + RR:143; QuestTitle QB:80 +
    ///                    OF:85; Level CLI:279 (QB:81 reads it but always gets 0, D46); Mainline QB:82;
    ///                    GoalData QB:183; QuestInfo OF:91; Rewards SG:211 (task 7.5).
    ///   MSG_SENDQUEST    QuestID QB:109 + OF:83,303; QuestTitle QB:108 + OF:303; QuestInfo OF:91;
    ///                    QuestNameID OF:93; NoQuestHelper OF:95; SkipQHAutoSelect OF:97; ActivityType
    ///                    OF:99; ClientTags OF:101; PetOnlyQuest OF:105 (read and reported on stderr: the
    ///                    quest schema has no home for it); Rewards SG:215 (task 7.5).
    ///   MSG_SENDGOAL     QuestID QB:124 + OF:120; GoalID QB:176 + OF:127 + RR:70; GoalNameID QB:126,134 +
    ///                    OF:127; GoalTitle QB:130,135 + RR:89; GoalLocation QB:136; GoalDestinationZone
    ///                    QB:137; GoalImage1 QB:138; GoalImage2 QB:139; GoalType QB:132,140 + RR:88 + CLI:167;
    ///                    GoalTotal QB:143,148; UseTally QB:147,154; GoalMadlibs QB:147-148; ClientTags
    ///                    QB:159-165; PersonaName OF:162; NoQuestHelper OF:165; PetOnlyQuest OF:167.
    ///   MSG_ACTORDIALOG  MobileID QB:242 + RR:161; QuestID QB:312 + RR:163; GoalID QB:371 + RR:179;
    ///                    CompletionType QB:243,311,396 + RR:333; ActorDialog QB:246,315,374 + RR:358;
    ///                    Persona QB:271,340,408; IsYesNo RR:321 and DefaultDialogAnimation RR:325 (read and
    ///                    reported on stderr: the dialog block has no field for either). PersonaName,
    ///                    PersonaIcon, RangeCheck, IsEncounter and PolymorphViewMobTemplateID are declared,
    ///                    never read.
    ///   MSG_ENCOUNTERDIALOG QuestID RR:233; GoalID RR:232; CompletionType RR:234; ActorDialog RR:358 (task
    ///                    7.4: a dialog block, never replacing one). MobileID, Persona, PersonaName and
    ///                    PersonaIcon are not read.
    ///   MSG_COMPLETEGOAL GoalID OF:70,158; CompleteText OF:169; QuestID SG:103 (task 7.5 packet order).
    ///   MSG_REMOVEGOAL   QuestID SG:103; GoalID SG:107 (task 7.5 packet order).
    ///   MSG_QUESTREWARDS QuestID SG:218; LootList SG:219 (task 7.5).
    ///   MSG_LOOT         LootList SG:230 (task 7.5; attributed to the preceding MSG_COMPLETEQUEST). GlobalID
    ///                    (the player) is not read.
    ///   MSG_PERSONAINFO  GoalID OF:70,159; GoalHyperlink OF:171.
    ///   MSG_COMPLETEQUEST QuestID OF:110; CompleteText OF:111 (read and reported on stderr: nothing shows
    ///                    it is the string-table key m_questComplete holds).
    ///   every other message has no reader, so nothing in it is read.
    /// </summary>
    private static readonly Dictionary<string, HashSet<string>> s_consumed = new(StringComparer.Ordinal) {
        ["MSG_QUESTOFFER"] = [
            "MobileID", "QuestName", "QuestTitle", "Level", "Mainline", "GoalData", "QuestInfo", "Rewards",
        ],
        ["MSG_SENDQUEST"] = [
            "QuestID", "QuestTitle", "QuestInfo", "QuestNameID", "NoQuestHelper", "SkipQHAutoSelect",
            "ActivityType", "ClientTags", "PetOnlyQuest", "Rewards",
        ],
        ["MSG_SENDGOAL"] = [
            "QuestID", "GoalID", "GoalNameID", "GoalTitle", "GoalLocation", "GoalDestinationZone",
            "GoalImage1", "GoalImage2", "GoalType", "GoalTotal", "UseTally", "GoalMadlibs", "ClientTags",
            "PersonaName", "NoQuestHelper", "PetOnlyQuest",
        ],
        ["MSG_ACTORDIALOG"] = [
            "MobileID", "QuestID", "GoalID", "CompletionType", "ActorDialog", "Persona", "IsYesNo",
            "DefaultDialogAnimation",
        ],
        ["MSG_ENCOUNTERDIALOG"] = ["QuestID", "GoalID", "CompletionType", "ActorDialog"],
        ["MSG_COMPLETEGOAL"] = ["GoalID", "CompleteText", "QuestID"],
        ["MSG_REMOVEGOAL"] = ["QuestID", "GoalID"],
        ["MSG_QUESTREWARDS"] = ["QuestID", "LootList"],
        ["MSG_LOOT"] = ["LootList"],
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
