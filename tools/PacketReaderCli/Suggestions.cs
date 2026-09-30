using System.Text.Json.Nodes;
using Imcodec.ObjectProperty;
using Imcodec.ObjectProperty.TypeCache;
using static PacketReaderCli.ObservedFields;

namespace PacketReaderCli;

/// <summary>
/// The Phase 7 <b>inferred</b> values (task 7.5, decisions D127/D138): what needs reasoning across packets or
/// a type mapping. They are never written into a template; <c>--suggestions &lt;path&gt;</c> writes them to a
/// sidecar file <c>{"suggestions":[{questName, path, value, source, confidence, note}]}</c>, and stdout stays
/// the unchanged D45 array.
///
/// <para><b>Packet order</b> (<c>source: "capture-order"</c>). The quest's <c>MSG_SENDGOAL</c>,
/// <c>MSG_COMPLETEGOAL</c>, <c>MSG_REMOVEGOAL</c> and <c>MSG_COMPLETEQUEST</c> are walked in capture order on
/// its <c>QuestID</c>, goals named through the <c>GoalID</c> join (D150). Goals sent before any completion are
/// the start goals. "Complete A, then remove A, then send B" makes A → B, one <c>m_goalLogic</c> entry
/// <c>{m_goalsAND:[A], m_goalsOR:[], m_goalsToAdd:[B…], m_completeQuest:false, m_requiredORCount:1}</c> (the
/// corpus's own shape, D61); the goal completed right before <c>MSG_COMPLETEQUEST</c> is the terminal one,
/// <c>{m_goalsAND:[Z], …, m_goalsToAdd:[], m_completeQuest:true}</c>. A capture with no A → B link (a single
/// goal) yields no chain. A chain is emitted only whole: a goal the join cannot name (excluded, or never
/// introduced) or a goal sent after a completion without the remove makes it a report instead, because a
/// chain with a gap strands goals.</para>
///
/// <para><b>Rewards</b> (<c>source: "capture-rewards"</c>). <c>MSG_QUESTOFFER.Rewards</c> (joined through the
/// title, QuestBuilder.cs:105-114), <c>MSG_SENDQUEST.Rewards</c>, <c>MSG_QUESTREWARDS.LootList</c> (by
/// <c>QuestID</c>) and <c>MSG_LOOT.LootList</c> decode through Imcodec's <see cref="LootInfoList"/>. MSG_LOOT
/// carries no <c>QuestID</c> (Imlight's LootGranter addresses the player), so it is attributed to the quest
/// whose <c>MSG_COMPLETEQUEST</c> most recently precedes it, as Imlight sends the end-result drops right after
/// that packet (QuestService.CompleteQuest). Each distinct loot entry is one suggestion at
/// <c>m_endResults.m_results</c> whose value is a labelled rolled observation
/// <c>{kind: gold|xp|item|spell, …, result}</c>, never a drop-table name. <c>result</c> is the corpus result
/// node that accepting would append: a spell is <c>ResLearnSpell {m_templateID}</c> (Imlight sends a quest's
/// ResLearnSpell as exactly this AddSpellLootInfo, QuestService.AppendSpellRewards); gold, XP and items have no
/// result type in the corpus schema (they come from the quest's drop table), so their <c>result</c> is
/// <c>null</c>. Any other loot class is reported.</para>
///
/// <para><b>Confidence</b> (D138: a number in [0,1]). A goal-logic chain closed by <c>MSG_COMPLETEQUEST</c>
/// and start goals are 0.8; a chain the capture never closes is 0.6. A spell is 0.6 (its school requirement
/// is not on the wire); gold, XP and items are 0.3 (one roll of a drop table that may roll differently, and
/// nothing the schema can hold).</para>
///
/// <para>Anything the pass cannot suggest is one <c>{"report":"suggestion", …}</c> line on stderr (D152's
/// keys).</para>
/// </summary>
internal static class Suggestions {

    private const string CaptureOrder = "capture-order";
    private const string CaptureRewards = "capture-rewards";
    private const string EndResultsPath = "m_endResults.m_results";
    private const uint PropLootInfoList = 31;
    private const string ResLearnSpellType = "Imcodec.ObjectProperty.TypeCache.ResLearnSpell, Imcodec.ObjectProperty";

    private static readonly HashSet<string> s_orderMessages =
        ["MSG_SENDGOAL", "MSG_COMPLETEGOAL", "MSG_REMOVEGOAL", "MSG_COMPLETEQUEST"];

    /// <summary>
    /// Infers the suggestions for every extracted quest. <paramref name="capture"/> is the capture as
    /// uploaded (before any goal exclusion, so an excluded goal is a visible gap); <paramref name="goalById"/>
    /// is the GoalID join of the extracted goals.
    /// </summary>
    internal static JsonArray Infer(
        List<QuestTemplate> quests, JsonNode capture, IReadOnlyDictionary<ulong, GoalTemplate> goalById,
        Action<string> report) {
        var envelopes = Envelopes(capture);
        var questIdByTitle = QuestIdsByTitle(envelopes);
        var suggestions = new JsonArray();

        var questByQuestId = new Dictionary<ulong, QuestTemplate>();
        foreach (var quest in quests) {
            if (quest.m_questName is { Length: > 0 } && quest.m_questTitle is not null
                && questIdByTitle.TryGetValue(quest.m_questTitle, out var questId)) {
                questByQuestId.TryAdd(questId, quest);
            }
        }

        foreach (var (questId, quest) in questByQuestId) {
            InferOrder(quest, questId, envelopes, goalById, suggestions, report);
        }

        InferRewards(questByQuestId, envelopes, questIdByTitle, suggestions, report);
        return suggestions;
    }

    // ---- packet order -----------------------------------------------------------------------------

    private static void InferOrder(
        QuestTemplate quest, ulong questId, List<Envelope> envelopes,
        IReadOnlyDictionary<ulong, GoalTemplate> goalById, JsonArray suggestions, Action<string> report) {
        var name = quest.m_questName!;
        var sent = new HashSet<ulong>();
        var startGoals = new List<string>();
        var links = new List<(string From, List<string> To)>();
        var steps = new List<string>();
        var gaps = new List<string>();
        (ulong Id, string? Name)? lastCompleted = null;
        string? awaiting = null;
        string? terminal = null;

        string? NameOf(ulong goalId) => goalById.GetValueOrDefault(goalId)?.m_goalName;

        foreach (var envelope in envelopes) {
            if (!s_orderMessages.Contains(envelope.Name) || ReadId(envelope.Fields, "QuestID") != questId) {
                continue;
            }

            var goalId = ReadId(envelope.Fields, "GoalID") ?? 0;
            var goal = NameOf(goalId);
            switch (envelope.Name) {
                case "MSG_SENDGOAL" when sent.Add(goalId):
                    if (goal is null) {
                        gaps.Add($"MSG_SENDGOAL GoalID {goalId} has no extracted goal");
                    }
                    else if (lastCompleted is null) {
                        startGoals.Add(goal);
                    }
                    else if (awaiting is not null) {
                        links.First(l => l.From == awaiting).To.Add(goal);
                        steps.Add($"MSG_COMPLETEGOAL {awaiting}, then MSG_REMOVEGOAL {awaiting}, then MSG_SENDGOAL {goal}");
                    }
                    else {
                        gaps.Add($"MSG_SENDGOAL {goal} has no named predecessor (no MSG_REMOVEGOAL of a named, just-completed goal before it)");
                    }

                    break;
                case "MSG_COMPLETEGOAL":
                    lastCompleted = (goalId, goal);
                    awaiting = null;
                    if (goal is null) {
                        gaps.Add($"MSG_COMPLETEGOAL GoalID {goalId} has no extracted goal");
                    }

                    break;
                case "MSG_REMOVEGOAL" when lastCompleted is { } completed && completed.Id == goalId && goal is not null:
                    awaiting = goal;
                    if (!links.Any(l => l.From == goal)) {
                        links.Add((goal, []));
                    }

                    break;
                case "MSG_COMPLETEQUEST":
                    terminal = lastCompleted?.Name;
                    break;
            }
        }

        if ((quest.m_startGoals?.Count ?? 0) == 0 && startGoals.Count > 0) {
            suggestions.Add(Suggestion(name, "m_startGoals", new JsonArray([.. startGoals.Select(g => (JsonNode) g)]),
                CaptureOrder, 0.8,
                $"MSG_SENDGOAL {string.Join(", ", startGoals)} before any MSG_COMPLETEGOAL on QuestID {questId}"));
        }

        if ((quest.m_goalLogic?.Count ?? 0) > 0) {
            // A template that already has goal logic is not second-guessed.
            return;
        }

        if (gaps.Count > 0) {
            Report(report, name, "m_goalLogic", "MSG_SENDGOAL/MSG_COMPLETEGOAL/MSG_REMOVEGOAL", JsonValue.Create(questId),
                $"no chain suggested: {string.Join("; ", gaps)} (a chain with a gap would strand goals)", "suggestion");
            return;
        }

        links.RemoveAll(l => l.To.Count == 0);
        if (links.Count == 0) {
            // No A -> B link (a single goal): no chain.
            return;
        }

        var chain = new JsonArray();
        foreach (var (from, to) in links) {
            chain.Add(LogicEntry([from], to, false));
        }

        if (terminal is not null) {
            chain.Add(LogicEntry([terminal], [], true));
            steps.Add($"MSG_COMPLETEGOAL {terminal}, then MSG_COMPLETEQUEST (the terminal goal)");
        }

        suggestions.Add(Suggestion(name, "m_goalLogic", chain, CaptureOrder, terminal is null ? 0.6 : 0.8,
            $"{string.Join("; ", steps)}, on QuestID {questId}"
            + (terminal is null ? "; no MSG_COMPLETEQUEST closes the quest, so no terminal goal" : "")));
    }

    private static JsonObject LogicEntry(List<string> and, List<string> toAdd, bool completeQuest) => new() {
        ["m_goalsAND"] = new JsonArray([.. and.Select(g => (JsonNode) g)]),
        ["m_goalsOR"] = new JsonArray(),
        ["m_goalsToAdd"] = new JsonArray([.. toAdd.Select(g => (JsonNode) g)]),
        ["m_completeQuest"] = completeQuest,
        ["m_requiredORCount"] = 1,
    };

    // ---- rewards ----------------------------------------------------------------------------------

    private sealed record Observed(string Quest, JsonObject Value, double Confidence, List<string> Sources);

    private static void InferRewards(
        Dictionary<ulong, QuestTemplate> questByQuestId, List<Envelope> envelopes,
        Dictionary<string, ulong> questIdByTitle, JsonArray suggestions, Action<string> report) {
        var observed = new List<Observed>();
        ulong? lastCompletedQuest = null;
        var goalCompletedSince = false;

        foreach (var envelope in envelopes) {
            ulong? questId = null;
            string? field = null;
            switch (envelope.Name) {
                case "MSG_QUESTOFFER":
                    questId = ReadString(envelope.Fields, "QuestTitle") is { } title
                        && questIdByTitle.TryGetValue(title, out var offered) ? offered : null;
                    field = "Rewards";
                    break;
                case "MSG_SENDQUEST":
                    questId = ReadId(envelope.Fields, "QuestID");
                    field = "Rewards";
                    break;
                case "MSG_QUESTREWARDS":
                    questId = ReadId(envelope.Fields, "QuestID");
                    field = "LootList";
                    break;
                case "MSG_COMPLETEQUEST":
                    lastCompletedQuest = ReadId(envelope.Fields, "QuestID");
                    goalCompletedSince = false;
                    continue;
                case "MSG_COMPLETEGOAL":
                    goalCompletedSince = true;
                    continue;
                case "MSG_LOOT":
                    questId = goalCompletedSince ? null : lastCompletedQuest;
                    field = "LootList";
                    break;
                default:
                    continue;
            }

            var source = $"{envelope.Name}.{field}";
            var blob = envelope.Fields[field]?["value"];
            if (blob is null || (blob is JsonValue text && text.TryGetValue<string>(out var hex) && hex.Length == 0)) {
                continue;
            }

            if (questId is null || !questByQuestId.TryGetValue(questId.Value, out var quest)) {
                Report(report, "", EndResultsPath, source, blob, envelope.Name == "MSG_LOOT"
                    ? "MSG_LOOT carries no QuestID and no MSG_COMPLETEQUEST of an extracted quest precedes it "
                        + "without a later MSG_COMPLETEGOAL (goal-result drops are not suggested)"
                    : $"no extracted quest has this {(envelope.Name == "MSG_QUESTOFFER" ? "QuestTitle" : "QuestID")}",
                    "suggestion");
                continue;
            }

            var name = quest.m_questName!;
            if (DecodeLoot(blob) is not { } list) {
                Report(report, name, EndResultsPath, source, blob, "the LootInfoList blob did not decode (mask 31)",
                    "suggestion");
                continue;
            }

            foreach (var entry in LootEntries(list)) {
                if (Observation(entry) is not { } value) {
                    Report(report, name, EndResultsPath, source, JsonValue.Create(entry.GetType().Name),
                        $"{entry.GetType().Name} ({entry.m_lootType}) has no suggestion kind (gold, xp, item, spell)",
                        "suggestion");
                    continue;
                }

                var key = value.Value.ToJsonString();
                var known = observed.FirstOrDefault(o => o.Quest == name && o.Value.ToJsonString() == key);
                if (known is null) {
                    observed.Add(new Observed(name, value.Value, value.Confidence, [source]));
                }
                else if (!known.Sources.Contains(source)) {
                    known.Sources.Add(source);
                }
            }
        }

        foreach (var (quest, value, confidence, sources) in observed) {
            var kind = value["kind"]!.GetValue<string>();
            var noResult = value["result"] is null
                ? $"; no corpus result type carries {(kind == "xp" ? "XP" : kind == "item" ? "items" : kind)} (the quest's drop table, which is not on the wire, rolled it), so accepting it writes nothing"
                : "; Imlight sends a quest's ResLearnSpell as this AddSpellLootInfo, and the spell's school requirement is not on the wire";
            suggestions.Add(Suggestion(quest, EndResultsPath, value, CaptureRewards, confidence,
                $"rolled observation ({Describe(value)}) from {string.Join(", ", sources)}; not a drop-table name{noResult}"));
        }
    }

    private static LootInfoList? DecodeLoot(JsonNode blob) {
        if (DecodeString(blob) is not { Ok: true } hex) {
            return null;
        }

        try {
            var serializer = new ObjectSerializer(false, SerializerFlags.None);
            return serializer.Deserialize<LootInfoList>(
                Convert.FromHexString(hex.Value.Replace(" ", string.Empty)), PropLootInfoList, out var list)
                ? list
                : null;
        }
        catch (Exception ex) when (ex is FormatException or InvalidOperationException
                                       or ArgumentException or IndexOutOfRangeException) {
            return null;
        }
    }

    /// <summary>Gold first (the list's own slot), then m_loot in wire order; a zero gold slot rolled nothing.</summary>
    private static IEnumerable<LootInfo> LootEntries(LootInfoList list) {
        if (list.m_goldInfo is { m_goldAmount: not 0 } gold) {
            yield return gold;
        }

        foreach (var entry in list.m_loot ?? []) {
            if (entry is not null) {
                yield return entry;
            }
        }
    }

    private static (JsonObject Value, double Confidence)? Observation(LootInfo entry) => entry switch {
        GoldLootInfo gold => (new JsonObject {
            ["kind"] = "gold", ["amount"] = gold.m_goldAmount, ["result"] = null,
        }, 0.3),
        MagicXPLootInfo xp => (string.IsNullOrEmpty(xp.m_magicSchool)
            ? new JsonObject { ["kind"] = "xp", ["amount"] = xp.m_experience, ["result"] = null }
            : new JsonObject { ["kind"] = "xp", ["amount"] = xp.m_experience, ["school"] = xp.m_magicSchool, ["result"] = null },
            0.3),
        ItemLootInfo item => (new JsonObject {
            ["kind"] = "item", ["itemId"] = item.m_itemID.Full, ["count"] = item.m_numItems, ["result"] = null,
        }, 0.3),
        AddSpellLootInfo spell => (new JsonObject {
            ["kind"] = "spell",
            ["spellId"] = spell.m_spellID,
            ["result"] = new JsonObject { ["$type"] = ResLearnSpellType, ["m_templateID"] = spell.m_spellID },
        }, 0.6),
        _ => null,
    };

    private static string Describe(JsonObject value) => value["kind"]!.GetValue<string>() switch {
        "gold" => $"gold {value["amount"]}",
        "xp" => $"XP {value["amount"]}{(value["school"] is { } school ? $" {school}" : "")}",
        "item" => $"item {value["itemId"]} x{value["count"]}",
        _ => $"spell {value["spellId"]}",
    };

    private static JsonObject Suggestion(
        string quest, string path, JsonNode value, string source, double confidence, string note) => new() {
        ["questName"] = quest,
        ["path"] = path,
        ["value"] = value,
        ["source"] = source,
        ["confidence"] = confidence,
        ["note"] = note,
    };

}
