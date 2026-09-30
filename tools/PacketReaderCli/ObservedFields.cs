using System.Text.Json.Nodes;
using Imcodec.ObjectProperty;
using Imcodec.ObjectProperty.TypeCache;
using Newtonsoft.Json;

namespace PacketReaderCli;

/// <summary>
/// The Phase 7 post-pass for <b>observed</b> fields (task 7.3, decisions D126/D127): after
/// <c>QuestBuilder</c> returns, re-read the capture's envelopes and copy the fields the reader drops or
/// never declares, verbatim, onto the quests and goals it built (the pattern of the D46 level repair).
///
/// <para><b>Joins — never by position.</b> A quest's <c>QuestID</c> is the first <c>MSG_SENDQUEST</c>
/// whose <c>QuestTitle</c> equals the quest's title, exactly as <c>QuestBuilder.AddQuestIDToQuestTemplate</c>
/// (QuestBuilder.cs:105-114) links them; <c>MSG_QUESTOFFER</c> has no <c>QuestID</c> and joins through the
/// same title map. A goal is tied to its <c>GoalID</c> by replaying QuestBuilder's own identity rule
/// (QuestBuilder.cs:123-128): walking the quest's <c>MSG_SENDGOAL</c>s in capture order, the first
/// <c>GoalID</c> to carry a <c>GoalNameID</c> owns the extracted goal with that <c>m_goalNameID</c> (a
/// compilation goal re-sent by packet included); a later <c>GoalID</c> with an already-owned
/// <c>GoalNameID</c> is the duplicate the reader skipped, so its values have no goal to land on and are
/// reported. <c>MSG_COMPLETEGOAL</c> and <c>MSG_PERSONAINFO</c> then join by <c>GoalID</c>.</para>
///
/// <para><b>What is written.</b> A value lands only when it decodes losslessly into the Imcodec-typed
/// property (a string, a 0/1 flag, a <c>uint</c>, a byte that Imcodec's <see cref="ActivityType"/> enum
/// maps, a <see cref="ClientTagList"/> blob through <see cref="ObjectSerializer"/> with mask 1 as
/// QuestBuilder decodes goal tags) and every observation of it agrees. Those types are the shared zod
/// schema's types for the same keys, so the wrapper cannot emit a value of the wrong type; the server
/// re-checks each written key against the zod schema itself (<c>screenObservedFields</c>). Empty strings
/// and empty tag lists are neither written nor reported: a capture cannot tell them from an absent field,
/// and writing them would turn the corpus's <c>null</c>s into <c>""</c> on save.</para>
///
/// <para><b>What is reported</b> (one JSON line on stderr per value, never on stdout): an undecodable
/// value, an unmapped enum byte, conflicting observations, a field the schema has no home for, and a
/// value whose goal the reader dropped.</para>
/// </summary>
internal static class ObservedFields {

    private sealed record Envelope(string Name, JsonObject Fields);

    private sealed record Observation(string Source, JsonNode? Value);

    private readonly record struct Decoded<T>(bool Ok, T Value, string? Reason) {
        public static Decoded<T> Of(T value) => new(true, value, null);
        public static Decoded<T> Fail(string reason) => new(false, default!, reason);
    }

    internal static void Apply(List<QuestTemplate> quests, JsonNode root, Action<string> report) {
        var envelopes = (root is JsonArray array ? array : [root])
            .Select(node => new Envelope(
                node!["data"]!["name"]!.GetValue<string>(), (JsonObject) node["data"]!["fields"]!))
            .ToList();

        // QuestBuilder.cs:105-114: the first MSG_SENDQUEST with a matching title supplies the QuestID.
        var questIdByTitle = new Dictionary<string, ulong>(StringComparer.Ordinal);
        foreach (var packet in Named(envelopes, "MSG_SENDQUEST")) {
            if (ReadString(packet, "QuestTitle") is { } title && ReadId(packet, "QuestID") is { } id) {
                questIdByTitle.TryAdd(title, id);
            }
        }

        var joinedGoalIds = new HashSet<ulong>();

        foreach (var quest in quests) {
            if (quest.m_questTitle is null || !questIdByTitle.TryGetValue(quest.m_questTitle, out var questId)) {
                continue;
            }

            ApplyQuestFields(quest, questId, envelopes, questIdByTitle, report);
            ApplyGoalFields(quest, questId, envelopes, joinedGoalIds, report);
        }

        // A goal-scoped message whose GoalID no extracted quest's MSG_SENDGOAL introduced.
        foreach (var (message, field) in new[] { ("MSG_COMPLETEGOAL", "CompleteText"), ("MSG_PERSONAINFO", "GoalHyperlink") }) {
            foreach (var packet in Named(envelopes, message)) {
                if (ReadId(packet, "GoalID") is { } goalId && !joinedGoalIds.Contains(goalId)
                    && packet.ContainsKey(field) && packet[field]?["value"] is var value && !IsEmptyString(value)) {
                    Report(report, "", $"GoalID {goalId}", $"{message}.{field}", value,
                        $"no MSG_SENDGOAL of an extracted quest introduces GoalID {goalId}");
                }
            }
        }
    }

    private static void ApplyQuestFields(
        QuestTemplate quest, ulong questId, List<Envelope> envelopes,
        Dictionary<string, ulong> questIdByTitle, Action<string> report) {

        var sendQuests = Named(envelopes, "MSG_SENDQUEST").Where(p => ReadId(p, "QuestID") == questId).ToList();
        var offers = Named(envelopes, "MSG_QUESTOFFER")
            .Where(p => ReadString(p, "QuestTitle") is { } title
                && questIdByTitle.TryGetValue(title, out var id) && id == questId)
            .ToList();
        var name = quest.m_questName ?? "";

        Resolve(report, name, "m_questInfo",
            [.. From(sendQuests, "MSG_SENDQUEST", "QuestInfo"), .. From(offers, "MSG_QUESTOFFER", "QuestInfo")],
            DecodeString, v => quest.m_questInfo = v);
        Resolve(report, name, "m_questNameID", From(sendQuests, "MSG_SENDQUEST", "QuestNameID"),
            DecodeUInt, v => quest.m_questNameID = v);
        Resolve(report, name, "m_noQuestHelper", From(sendQuests, "MSG_SENDQUEST", "NoQuestHelper"),
            DecodeFlag, v => quest.m_noQuestHelper = v);
        Resolve(report, name, "m_skipQHAutoSelect", From(sendQuests, "MSG_SENDQUEST", "SkipQHAutoSelect"),
            DecodeFlag, v => quest.m_skipQHAutoSelect = v);
        Resolve(report, name, "m_activityType", From(sendQuests, "MSG_SENDQUEST", "ActivityType"),
            DecodeActivity, v => quest.m_activityType = v);
        Resolve(report, name, "m_clientTags", From(sendQuests, "MSG_SENDQUEST", "ClientTags"),
            DecodeClientTags, v => quest.m_clientTags = v);

        // No quest-level home in the schema (m_petOnlyQuest is a goal field): read, then reported.
        Resolve(report, name, "m_petOnlyQuest", From(sendQuests, "MSG_SENDQUEST", "PetOnlyQuest"),
            DecodeFlag, null, "the quest schema has no m_petOnlyQuest (only goals carry it)", v => !v);

        // spec-domain-reference "Phase 7: the post-pass's observed fields": m_questComplete is a
        // string-table key, and nothing shows the packet's text is one (Imlight never fills it).
        var completeQuests = Named(envelopes, "MSG_COMPLETEQUEST").Where(p => ReadId(p, "QuestID") == questId).ToList();
        Resolve(report, name, "m_questComplete", From(completeQuests, "MSG_COMPLETEQUEST", "CompleteText"),
            DecodeString, null,
            "m_questComplete is a string-table key; nothing shows MSG_COMPLETEQUEST.CompleteText carries the same kind of value");
    }

    private static void ApplyGoalFields(
        QuestTemplate quest, ulong questId, List<Envelope> envelopes, HashSet<ulong> joinedGoalIds,
        Action<string> report) {

        var sendGoals = Named(envelopes, "MSG_SENDGOAL").Where(p => ReadId(p, "QuestID") == questId).ToList();
        var name = quest.m_questName ?? "";

        // Replay QuestBuilder's identity rule (see the class remarks): GoalNameID -> owning GoalID.
        var ownerByNameId = new Dictionary<uint, ulong>();
        var goalIds = new List<(ulong GoalId, uint NameId)>();
        foreach (var packet in sendGoals) {
            if (ReadId(packet, "GoalID") is not { } goalId || ReadId(packet, "GoalNameID") is not { } nameId
                || nameId > uint.MaxValue) {
                continue;
            }

            ownerByNameId.TryAdd((uint) nameId, goalId);
            if (!goalIds.Any(g => g.GoalId == goalId)) {
                goalIds.Add((goalId, (uint) nameId));
            }
        }

        foreach (var (goalId, nameId) in goalIds) {
            joinedGoalIds.Add(goalId);

            var mine = sendGoals.Where(p => ReadId(p, "GoalID") == goalId).ToList();
            var owner = ownerByNameId[nameId];
            var goal = owner == goalId ? quest.m_goals?.FirstOrDefault(g => g.m_goalNameID == nameId) : null;

            string path;
            string? dropped = null;
            if (goal is null) {
                path = $"m_goals[GoalID {goalId}]";
                dropped = owner == goalId
                    ? $"no extracted goal has m_goalNameID {nameId}"
                    : $"the reader dropped this goal: GoalNameID {nameId} is already owned by GoalID {owner} "
                        + "(QuestBuilder skips a duplicate GoalNameID)";
            }
            else {
                path = $"m_goals[{goal.m_goalName}]";
            }

            var completes = Named(envelopes, "MSG_COMPLETEGOAL").Where(p => ReadId(p, "GoalID") == goalId).ToList();
            var personaInfos = Named(envelopes, "MSG_PERSONAINFO").Where(p => ReadId(p, "GoalID") == goalId).ToList();

            var persona = goal as PersonaGoalTemplate;
            Resolve(report, name, $"{path}.m_personaName", From(mine, "MSG_SENDGOAL", "PersonaName"),
                DecodeString, persona is null ? null : v => persona.m_personaName = v,
                dropped ?? (persona is null ? $"{goal!.GetType().Name} has no m_personaName (only PersonaGoalTemplate does)" : null));
            Resolve(report, name, $"{path}.m_noQuestHelper", From(mine, "MSG_SENDGOAL", "NoQuestHelper"),
                DecodeFlag, goal is null ? null : v => goal.m_noQuestHelper = v, dropped, v => !v);
            Resolve(report, name, $"{path}.m_petOnlyQuest", From(mine, "MSG_SENDGOAL", "PetOnlyQuest"),
                DecodeFlag, goal is null ? null : v => goal.m_petOnlyQuest = v, dropped, v => !v);
            Resolve(report, name, $"{path}.m_completeText", From(completes, "MSG_COMPLETEGOAL", "CompleteText"),
                DecodeString, goal is null ? null : v => goal.m_completeText = v, dropped);
            Resolve(report, name, $"{path}.m_hyperlink", From(personaInfos, "MSG_PERSONAINFO", "GoalHyperlink"),
                DecodeString, goal is null ? null : v => goal.m_hyperlink = v, dropped);
        }
    }

    /// <summary>
    /// Decodes every observation of one target field and writes the agreed value, or reports why not.
    /// <paramref name="write"/> null means the field has no home (<paramref name="unwritable"/> says
    /// why). <paramref name="silentWhenUnwritable"/> marks values that carry nothing worth reporting
    /// there (a zero flag).
    /// </summary>
    private static void Resolve<T>(
        Action<string> report, string quest, string path, List<Observation> observations,
        Func<JsonNode?, Decoded<T>> decode, Action<T>? write, string? unwritable = null,
        Func<T, bool>? silentWhenUnwritable = null) {

        var values = new List<(Observation Observation, T Value)>();
        foreach (var observation in observations) {
            var decoded = decode(observation.Value);
            if (!decoded.Ok) {
                Report(report, quest, path, observation.Source, observation.Value, decoded.Reason!);
            }
            else if (!IsEmpty(decoded.Value)) {
                values.Add((observation, decoded.Value));
            }
        }

        if (values.Count == 0) {
            return;
        }

        if (write is null || unwritable is not null) {
            foreach (var (observation, value) in values) {
                if (silentWhenUnwritable?.Invoke(value) != true) {
                    Report(report, quest, path, observation.Source, observation.Value,
                        unwritable ?? "no field to write it to");
                }
            }

            return;
        }

        var distinct = values.Select(v => JsonConvert.SerializeObject(v.Value)).Distinct().ToList();
        if (distinct.Count > 1) {
            foreach (var (observation, _) in values) {
                Report(report, quest, path, observation.Source, observation.Value,
                    $"conflicting observations: {string.Join(" vs ", distinct)}");
            }

            return;
        }

        write(values[0].Value);
    }

    private static bool IsEmpty<T>(T value) => value switch {
        string text => text.Length == 0,
        List<string> list => list.Count == 0,
        _ => false,
    };

    private static void Report(
        Action<string> report, string quest, string path, string source, JsonNode? value, string reason)
        => report(new JsonObject {
            ["report"] = "observed-field",
            ["quest"] = quest,
            ["path"] = path,
            ["source"] = source,
            ["value"] = value?.DeepClone(),
            ["reason"] = reason,
        }.ToJsonString());

    // ---- decoders: each is lossless or fails with a reason ---------------------------------------

    private static Decoded<string> DecodeString(JsonNode? value)
        => value is JsonValue json && json.TryGetValue<string>(out var text)
            ? Decoded<string>.Of(text)
            : Decoded<string>.Fail("not a string");

    private static Decoded<bool> DecodeFlag(JsonNode? value) => ReadInteger(value) switch {
        0 => Decoded<bool>.Of(false),
        1 => Decoded<bool>.Of(true),
        _ => Decoded<bool>.Fail("a UBYT flag must be 0 or 1 to map losslessly onto a boolean"),
    };

    private static Decoded<uint> DecodeUInt(JsonNode? value)
        => ReadInteger(value) is { } number and >= 0 and <= uint.MaxValue
            ? Decoded<uint>.Of((uint) number)
            : Decoded<uint>.Fail("not an unsigned 32-bit integer");

    // Byte -> ACTIVITY_* literal through Imcodec's own generated enum (ActivityType.g.cs).
    private static Decoded<ActivityType> DecodeActivity(JsonNode? value)
        => ReadInteger(value) is { } number and >= 0 and <= byte.MaxValue
            && Enum.IsDefined(typeof(ActivityType), (int) number)
            ? Decoded<ActivityType>.Of((ActivityType) (int) number)
            : Decoded<ActivityType>.Fail("the byte has no mapping in Imcodec's ActivityType enum");

    // Blob -> string list through Imcodec's serializer, the way QuestBuilder decodes goal tags (mask 1).
    private static Decoded<List<string>> DecodeClientTags(JsonNode? value) {
        if (DecodeString(value) is not { Ok: true } hex) {
            return Decoded<List<string>>.Fail("not a hex string");
        }

        if (hex.Value.Length == 0) {
            return Decoded<List<string>>.Of([]);
        }

        try {
            var bytes = Convert.FromHexString(hex.Value.Replace(" ", string.Empty));
            var serializer = new ObjectSerializer(false, SerializerFlags.None);
            return serializer.Deserialize<ClientTagList>(bytes, 1, out var tags)
                ? Decoded<List<string>>.Of(tags?.m_clientTags ?? [])
                : Decoded<List<string>>.Fail("the ClientTagList blob did not decode");
        }
        catch (Exception ex) when (ex is FormatException or InvalidOperationException
                                       or ArgumentException or IndexOutOfRangeException) {
            return Decoded<List<string>>.Fail($"the ClientTagList blob did not decode: {ex.Message}");
        }
    }

    // ---- envelope access -------------------------------------------------------------------------

    private static IEnumerable<JsonObject> Named(List<Envelope> envelopes, string name)
        => envelopes.Where(e => e.Name == name).Select(e => e.Fields);

    private static List<Observation> From(List<JsonObject> packets, string message, string field)
        => [.. packets.Where(p => p.ContainsKey(field)).Select(p => new Observation($"{message}.{field}", p[field]?["value"]))];

    private static string? ReadString(JsonObject packet, string field)
        => packet[field]?["value"] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;

    private static ulong? ReadId(JsonObject packet, string field) {
        if (packet[field]?["value"] is not JsonValue value) {
            return null;
        }

        return value.TryGetValue<ulong>(out var id) ? id
            : value.TryGetValue<string>(out var text) && ulong.TryParse(text, out id) ? id
            : null;
    }

    private static long? ReadInteger(JsonNode? node) {
        if (node is not JsonValue value) {
            return null;
        }

        if (value.TryGetValue<long>(out var number)) {
            return number;
        }

        return value.TryGetValue<double>(out var floating) && floating % 1 == 0
            && floating >= long.MinValue && floating <= long.MaxValue
            ? (long) floating
            : null;
    }

    private static bool IsEmptyString(JsonNode? node)
        => node is JsonValue value && value.TryGetValue<string>(out var text) && text.Length == 0;

}
