using System.Text.Json.Nodes;
using Imcodec.ObjectProperty;
using Imcodec.ObjectProperty.TypeCache;
using Newtonsoft.Json;
using static PacketReaderCli.ObservedFields;

namespace PacketReaderCli;

/// <summary>
/// The Phase 7 reader-defect repairs (task 7.4, decision D126): after <c>QuestBuilder</c> returns, re-read
/// the capture and correct what the reader gets wrong, joined by <c>QuestID</c>/<c>GoalID</c> and never by
/// position. Imview is never edited.
///
/// <list type="bullet">
/// <item><b>Goals the reader drops</b> (<see cref="JoinGoals"/>). QuestBuilder skips a <c>MSG_SENDGOAL</c>
/// whose <c>GoalNameID</c> it has already seen (QuestBuilder.cs:126), so every <c>GOAL_TYPE_ACHIEVERANK</c>
/// goal after the first collapses into one goal named <c>1_</c>: their titles are empty and their
/// <c>GoalNameID</c> is 0. A later <c>GoalID</c> whose packet is an ACHIEVERANK goal with an empty title is
/// therefore a distinct goal: it is added from its packet, in capture order, and every packet-delivered
/// goal is named <c>{n}_{GoalTitle}</c> by its position n, the reader's own derivation. The corpus names
/// of those goals ("Trigger Storm", ...) are not on the wire, so they cannot be reproduced.</item>
/// <item><b>Quest-level dialogs by GoalID</b> (<see cref="RepairDialogs"/>). QuestBuilder takes the quest's
/// Prep dialog from the first <c>QuestInfo</c> packet of the offer's <c>MobileID</c> and its Completion
/// dialog from the first <c>Completion</c> packet of its <c>QuestID</c>, ignoring <c>GoalID</c>
/// (QuestBuilder.cs:242,311; D46(4)). The game server sends a goal's Completion dialog with the quest id,
/// so a goal's dialog lands on the quest and the quest's own is lost. The repair takes each from the first
/// such packet whose <c>GoalID</c> is 0, or removes it when there is none.</item>
/// <item><b>Goal dialogs by GoalID</b>. QuestBuilder maps a <c>GoalID</c> only for a goal it added from a
/// packet, so a compilation goal re-sent by <c>MSG_SENDGOAL</c> (as the server sends every started goal)
/// and a recovered goal lose their dialogs. The repair attaches them with QuestBuilder's own tag rule.</item>
/// <item><b>More dialog</b>. A quest-level <c>Underway</c> <c>MSG_ACTORDIALOG</c> (QuestBuilder maps
/// <c>underway</c> only for goals) and <c>MSG_ENCOUNTERDIALOG</c> (never read) become dialog blocks. An
/// encounter dialog never replaces a block of the same tag: an identical one is skipped, a different one
/// is reported. <c>MSG_ACTORDIALOG.IsYesNo</c> and <c>.DefaultDialogAnimation</c> are read and reported:
/// the dialog block has no field for either.</item>
/// </list>
///
/// A change to what QuestBuilder produced is reported as one JSON line,
/// <c>{"report":"reader-repair", quest, path, source, value, reason}</c>; an observed value with no home
/// uses the observed-field line (D152).
/// </summary>
internal static class ReaderRepairs {

    private const uint PropAuthorityTransmit = 16;

    internal sealed record GoalJoin(Dictionary<ulong, GoalTemplate> ById, HashSet<ulong> ReaderMapped);

    /// <summary>
    /// Builds the GoalID → goal join (D150) for every extracted quest, recovering the ACHIEVERANK goals the
    /// reader dropped. <see cref="GoalJoin.ReaderMapped"/> holds the GoalIDs QuestBuilder mapped itself
    /// (the goals it added from a packet), whose dialogs it already attached.
    /// </summary>
    internal static GoalJoin JoinGoals(List<QuestTemplate> quests, JsonNode root, Action<string> report) {
        var envelopes = Envelopes(root);
        var questIdByTitle = QuestIdsByTitle(envelopes);
        var join = new GoalJoin([], []);

        foreach (var quest in quests) {
            if (quest.m_questTitle is null || !questIdByTitle.TryGetValue(quest.m_questTitle, out var questId)) {
                continue;
            }

            quest.m_goals ??= [];
            var compilationCount = quest.m_startGoals?.Count ?? 0;
            var ownerByNameId = new Dictionary<uint, ulong>();
            var packetOrder = new List<GoalTemplate>();
            var recovered = new List<(GoalTemplate Goal, ulong GoalId, ulong Owner)>();

            foreach (var packet in Named(envelopes, "MSG_SENDGOAL").Where(p => ReadId(p, "QuestID") == questId)) {
                if (ReadId(packet, "GoalID") is not { } goalId || join.ById.ContainsKey(goalId)
                    || ReadId(packet, "GoalNameID") is not { } rawNameId || rawNameId > uint.MaxValue) {
                    continue;
                }

                var nameId = (uint) rawNameId;
                if (ownerByNameId.TryAdd(nameId, goalId)) {
                    var index = quest.m_goals.FindIndex(g => g.m_goalNameID == nameId);
                    if (index < 0) {
                        continue;
                    }

                    join.ById[goalId] = quest.m_goals[index];
                    if (index >= compilationCount) {
                        join.ReaderMapped.Add(goalId);
                        packetOrder.Add(quest.m_goals[index]);
                    }
                }
                else if (ReadInteger(packet["GoalType"]?["value"]) == (int) GOAL_TYPE.GOAL_TYPE_ACHIEVERANK
                         && string.IsNullOrEmpty(ReadString(packet, "GoalTitle"))) {
                    var goal = GoalFromPacket(packet);
                    join.ById[goalId] = goal;
                    packetOrder.Add(goal);
                    recovered.Add((goal, goalId, ownerByNameId[nameId]));
                }
            }

            if (recovered.Count == 0) {
                continue;
            }

            // Compilation goals first (QuestBuilder's m_startGoals), then the packet goals in capture order,
            // each named by its position; any packet goal the walk did not meet keeps its place at the end.
            var goals = quest.m_goals.Take(compilationCount).ToList();
            goals.AddRange(packetOrder);
            goals.AddRange(quest.m_goals.Skip(compilationCount).Where(g => !packetOrder.Contains(g)));

            var name = quest.m_questName ?? "";
            for (var i = compilationCount; i < goals.Count; i++) {
                var goal = goals[i];
                var before = goal.m_goalName;
                goal.m_goalName = $"{i + 1}_{goal.m_goalTitle}";

                if (recovered.FirstOrDefault(r => ReferenceEquals(r.Goal, goal)) is { Goal: not null } added) {
                    Report(report, name, $"m_goals[{goal.m_goalName}]", "MSG_SENDGOAL", JsonValue.Create(added.GoalId),
                        $"added: this GOAL_TYPE_ACHIEVERANK goal has an empty GoalTitle and GoalNameID {goal.m_goalNameID}, "
                        + $"which GoalID {added.Owner} already owns, so QuestBuilder skipped it as a duplicate; it is "
                        + "named {n}_{GoalTitle} by its capture position (the corpus goal name is not on the wire)",
                        "reader-repair");
                }
                else if (before != goal.m_goalName) {
                    Report(report, name, $"m_goals[{goal.m_goalName}]", "MSG_SENDGOAL", JsonValue.Create(before),
                        $"renamed from '{before}': a recovered ACHIEVERANK goal precedes it in capture order",
                        "reader-repair");
                }
            }

            quest.m_goals = goals;
        }

        return join;
    }

    /// <summary>Re-attaches the dialogs QuestBuilder attaches by position or not at all (see the class remarks).</summary>
    internal static void RepairDialogs(
        List<QuestTemplate> quests, JsonNode root, GoalJoin join, Action<string> report) {
        var envelopes = Envelopes(root);
        var questIdByTitle = QuestIdsByTitle(envelopes);
        var actorDialogs = Named(envelopes, "MSG_ACTORDIALOG").ToList();

        // QuestBuilder.cs:88: the offer's MobileID keyed by quest name (a later offer overwrites).
        var mobileIdByName = new Dictionary<string, ulong>(StringComparer.Ordinal);
        foreach (var offer in Named(envelopes, "MSG_QUESTOFFER")) {
            if (ReadString(offer, "QuestName") is { } questName && ReadId(offer, "MobileID") is { } mobileId) {
                mobileIdByName[questName] = mobileId;
            }
        }

        var questById = new Dictionary<ulong, QuestTemplate>();

        foreach (var quest in quests) {
            if (quest.m_questTitle is null || !questIdByTitle.TryGetValue(quest.m_questTitle, out var questId)) {
                continue;
            }

            questById.TryAdd(questId, quest);
            var name = quest.m_questName ?? "";
            var mobileId = mobileIdByName.GetValueOrDefault(quest.m_questName ?? "");

            // QuestBuilder.cs:241-243 (Prep: MobileID + "QuestInfo") and :310-312 (Completion: QuestID).
            RepairQuestDialog(quest, name, "Prep", actorDialogs,
                p => ReadId(p, "MobileID") == mobileId && IsCompletionType(p, "QuestInfo"), report);
            RepairQuestDialog(quest, name, "Completion", actorDialogs,
                p => ReadId(p, "QuestID") == questId && IsCompletionType(p, "Completion"), report);

            // An Underway dialog at quest level: QuestBuilder maps "underway" for goals only (QuestBuilder.cs:399).
            var underway = actorDialogs
                .Where(p => ReadId(p, "QuestID") == questId && (ReadId(p, "GoalID") ?? 0) == 0
                    && IsCompletionType(p, "Underway"))
                .Select(DecodeDialog)
                .FirstOrDefault(d => d is not null);
            if (underway is not null) {
                SetDialog(quest.m_dialogList, v => quest.m_dialogList = v, "Underway", underway);
            }
        }

        // Goal dialogs of the goals QuestBuilder did not map itself, with its tag rule and its
        // replace-by-tag semantics (QuestBuilder.cs:370-422).
        foreach (var packet in actorDialogs) {
            if (ReadId(packet, "GoalID") is { } goalId and not 0 && !join.ReaderMapped.Contains(goalId)
                && join.ById.TryGetValue(goalId, out var goal) && DecodeDialog(packet) is { } dialog) {
                SetDialog(goal.m_dialogList, v => goal.m_dialogList = v, GoalTag(packet), dialog);
            }
        }

        foreach (var packet in Named(envelopes, "MSG_ENCOUNTERDIALOG")) {
            ApplyEncounterDialog(packet, questById, join, report);
        }

        foreach (var packet in actorDialogs) {
            ReportDialogFlags(packet, questById, mobileIdByName, quests, join, report);
        }
    }

    private static void RepairQuestDialog(
        QuestTemplate quest, string name, string tag, List<JsonObject> packets, Func<JsonObject, bool> matches,
        Action<string> report) {
        // QuestBuilder's pick: the first matching packet that decodes, whatever its GoalID.
        var candidates = packets.Where(matches).Select(p => (Packet: p, Dialog: DecodeDialog(p)))
            .Where(c => c.Dialog is not null).ToList();
        if (candidates.Count == 0) {
            return;
        }

        var readerPick = candidates[0];
        var readerGoalId = ReadId(readerPick.Packet, "GoalID") ?? 0;
        if (readerGoalId == 0) {
            return;
        }

        var questLevel = candidates.FirstOrDefault(c => (ReadId(c.Packet, "GoalID") ?? 0) == 0);
        if (questLevel.Dialog is not null) {
            SetDialog(quest.m_dialogList, v => quest.m_dialogList = v, tag, questLevel.Dialog);
        }
        else if (quest.m_dialogList is ActorDialogList list) {
            list.m_dialogs?.RemoveAll(d => string.Equals(d.m_dialogTag, tag, StringComparison.OrdinalIgnoreCase));
            if (list.m_dialogs is not { Count: > 0 }) {
                // QuestBuilder creates the list only to add a dialog, so an emptied list was never there.
                quest.m_dialogList = null;
            }
        }

        Report(report, name, $"m_dialogList[{tag}]", "MSG_ACTORDIALOG.GoalID", JsonValue.Create(readerGoalId),
            (questLevel.Dialog is not null
                ? $"replaced: QuestBuilder took the quest's {tag} dialog from GoalID {readerGoalId}'s packet (it ignores GoalID); the first {tag} packet with GoalID 0 is the quest's"
                : $"removed: QuestBuilder took the quest's {tag} dialog from GoalID {readerGoalId}'s packet (it ignores GoalID), and no {tag} packet has GoalID 0")
            + " (D46(4))",
            "reader-repair");
    }

    private static void ApplyEncounterDialog(
        JsonObject packet, Dictionary<ulong, QuestTemplate> questById, GoalJoin join, Action<string> report) {
        var goalId = ReadId(packet, "GoalID") ?? 0;
        var questId = ReadId(packet, "QuestID") ?? 0;
        var completionType = ReadString(packet, "CompletionType") ?? "";
        var dialogValue = packet["ActorDialog"]?["value"];

        if (dialogValue is null || IsEmptyValue(dialogValue)) {
            return;
        }

        QuestTemplate? quest = null;
        GoalTemplate? goal = null;
        string? tag;
        string owner;
        if (goalId != 0) {
            goal = join.ById.GetValueOrDefault(goalId);
            quest = goal is null ? null : questById.Values.FirstOrDefault(q => q.m_goals?.Contains(goal) == true);
            tag = GoalTag(packet);
            owner = goal is null ? $"m_goals[GoalID {goalId}]" : $"m_goals[{goal.m_goalName}]";
        }
        else {
            quest = questById.GetValueOrDefault(questId);
            tag = QuestTag(completionType);
            owner = "";
        }

        var questName = quest?.m_questName ?? "";
        var path = $"{(owner.Length == 0 ? "" : owner + ".")}m_dialogList[{tag ?? completionType}]";
        var dialog = DecodeDialog(packet);
        string? reason = dialog is null ? "the ActorDialog blob did not decode (mask 16)"
            : quest is null ? (goalId != 0
                ? $"no MSG_SENDGOAL of an extracted quest introduces GoalID {goalId}"
                : $"no extracted quest has QuestID {questId}")
            : tag is null ? $"CompletionType '{completionType}' has no quest-level dialog tag (QuestInfo -> Prep, Completion, Underway)"
            : null;

        if (reason is null) {
            var existing = ((goal is not null ? goal.m_dialogList : quest!.m_dialogList) as ActorDialogList)?.m_dialogs?
                .FirstOrDefault(d => string.Equals(d.m_dialogTag, tag, StringComparison.OrdinalIgnoreCase));
            dialog!.m_dialogTag = tag;

            if (existing is null) {
                if (goal is not null) {
                    SetDialog(goal.m_dialogList, v => goal.m_dialogList = v, tag!, dialog);
                }
                else {
                    SetDialog(quest!.m_dialogList, v => quest.m_dialogList = v, tag!, dialog);
                }

                return;
            }

            if (JsonConvert.SerializeObject(existing) == JsonConvert.SerializeObject(dialog)) {
                return;
            }

            reason = $"the container already has a different '{tag}' dialog block (an encounter dialog never replaces one)";
        }

        Report(report, questName, path, "MSG_ENCOUNTERDIALOG.ActorDialog", dialogValue, reason);
    }

    /// <summary>IsYesNo / DefaultDialogAnimation: read, and reported where set (no dialog-block field).</summary>
    private static void ReportDialogFlags(
        JsonObject packet, Dictionary<ulong, QuestTemplate> questById, Dictionary<string, ulong> mobileIdByName,
        List<QuestTemplate> quests, GoalJoin join, Action<string> report) {
        if (!packet.ContainsKey("IsYesNo") && !packet.ContainsKey("DefaultDialogAnimation")) {
            return;
        }

        var goalId = ReadId(packet, "GoalID") ?? 0;
        var questId = ReadId(packet, "QuestID") ?? 0;
        var mobileId = ReadId(packet, "MobileID") ?? 0;
        string path;
        QuestTemplate? quest;

        if (goalId != 0) {
            var goal = join.ById.GetValueOrDefault(goalId);
            quest = goal is null ? null : quests.FirstOrDefault(q => q.m_goals?.Contains(goal) == true);
            path = $"{(goal is null ? $"m_goals[GoalID {goalId}]" : $"m_goals[{goal.m_goalName}]")}.m_dialogList[{GoalTag(packet)}]";
        }
        else {
            quest = questById.GetValueOrDefault(questId)
                ?? quests.FirstOrDefault(q => q.m_questName is { } n && mobileIdByName.GetValueOrDefault(n) == mobileId
                    && mobileId != 0);
            path = $"m_dialogList[{QuestTag(ReadString(packet, "CompletionType") ?? "") ?? ReadString(packet, "CompletionType")}]";
        }

        var name = quest?.m_questName ?? "";
        List<JsonObject> one = [packet];
        Resolve(report, name, $"{path}.IsYesNo", From(one, "MSG_ACTORDIALOG", "IsYesNo"), DecodeFlag, null,
            "the dialog block (m_dialogTag, m_dialogEntries, m_madlibs, m_dialogEvents, m_noAggro*) and its "
            + "entries have no yes/no field", v => !v);
        Resolve(report, name, $"{path}.DefaultDialogAnimation",
            From(one, "MSG_ACTORDIALOG", "DefaultDialogAnimation"), DecodeString, null,
            "the dialog block has no default-animation field; QuestTemplate.m_defaultDialogAnimation is "
            + "quest-scoped and nothing shows a per-dialog packet value is the quest's");
    }

    // ---- helpers ---------------------------------------------------------------------------------

    private static bool IsCompletionType(JsonObject packet, string completionType)
        => string.Equals(ReadString(packet, "CompletionType"), completionType, StringComparison.OrdinalIgnoreCase);

    /// <summary>QuestBuilder's goal-dialog tag rule (QuestBuilder.cs:396-403).</summary>
    private static string GoalTag(JsonObject packet) {
        var completionType = ReadString(packet, "CompletionType");
        return completionType?.ToLower() switch {
            "questinfo" => "QuestInfo",
            "prep" => "Prep",
            "underway" => "Underway",
            "completion" => "Completion",
            "hyperlink" => "Hyperlink",
            _ => completionType ?? "QuestInfo",
        };
    }

    /// <summary>The quest-level tags QuestBuilder assigns (QuestInfo -> Prep, Completion), plus Underway.</summary>
    private static string? QuestTag(string completionType) => completionType.ToLower() switch {
        "questinfo" => "Prep",
        "completion" => "Completion",
        "underway" => "Underway",
        _ => null,
    };

    /// <summary>QuestBuilder's dialog decode: the hex blob through ObjectSerializer with mask 16.</summary>
    private static ActorDialog? DecodeDialog(JsonObject packet) {
        if (ReadString(packet, "ActorDialog") is not { Length: > 0 } hex) {
            return null;
        }

        try {
            var serializer = new ObjectSerializer(false, SerializerFlags.None);
            return serializer.Deserialize<ActorDialog>(
                Convert.FromHexString(hex.Replace(" ", string.Empty)), PropAuthorityTransmit, out var dialog)
                ? dialog
                : null;
        }
        catch (Exception ex) when (ex is FormatException or InvalidOperationException
                                       or ArgumentException or IndexOutOfRangeException) {
            return null;
        }
    }

    /// <summary>Adds the dialog under <paramref name="tag"/>, replacing a block of that tag (QuestBuilder's rule).</summary>
    private static void SetDialog(
        ActorDialogListBase? current, Action<ActorDialogList> assign, string tag, ActorDialog dialog) {
        if (current is not ActorDialogList list) {
            list = new ActorDialogList { m_dialogs = [] };
            assign(list);
        }

        list.m_dialogs ??= [];
        dialog.m_dialogTag = tag;
        var index = list.m_dialogs.FindIndex(d => string.Equals(d.m_dialogTag, tag, StringComparison.OrdinalIgnoreCase));
        if (index >= 0) {
            list.m_dialogs[index] = dialog;
        }
        else {
            list.m_dialogs.Add(dialog);
        }
    }

    /// <summary>The goal QuestBuilder would have built from this packet (QuestBuilder.cs:130-171).</summary>
    private static GoalTemplate GoalFromPacket(JsonObject packet) {
        var goal = new AchieveRankGoalTemplate {
            m_goalNameID = (uint) (ReadId(packet, "GoalNameID") ?? 0),
            m_goalTitle = ReadString(packet, "GoalTitle"),
            m_locationName = ReadString(packet, "GoalLocation"),
            m_destinationZone = ReadString(packet, "GoalDestinationZone"),
            m_displayImage1 = ReadString(packet, "GoalImage1"),
            m_displayImage2 = ReadString(packet, "GoalImage2"),
            m_goalType = GOAL_TYPE.GOAL_TYPE_ACHIEVERANK,
        };

        var useTally = ReadInteger(packet["UseTally"]?["value"]);
        var madlibs = ReadString(packet, "GoalMadlibs");
        if (useTally == 1 && !string.IsNullOrEmpty(madlibs)) {
            goal.m_tallyCounter = TallyCounterFromMadlibs(madlibs, (int) (ReadInteger(packet["GoalTotal"]?["value"]) ?? 0));
        }
        else if (useTally == 0) {
            goal.m_tallyCounter = null;
        }

        if (packet["ClientTags"]?["value"] is { } tags && DecodeClientTags(tags) is { Ok: true, Value.Count: > 0 } decoded) {
            goal.m_clientTags = decoded.Value;
        }

        return goal;
    }

    /// <summary>QuestBuilder.ParseTallyCounterFromMadlibs (QuestBuilder.cs:503-543), which is private.</summary>
    private static TallyCounterTemplate? TallyCounterFromMadlibs(string hex, int goalTotal) {
        try {
            var serializer = new ObjectSerializer(false, SerializerFlags.None);
            if (!serializer.Deserialize<MadlibBlock>(Convert.FromHexString(hex.Replace(" ", string.Empty)), 1, out var block)) {
                return null;
            }

            var strings = (block?.m_madlibs ?? []).OfType<MadlibArgT_ByteString>().ToList();
            string? Token(string token) => strings.LastOrDefault(m =>
                string.Equals(m.m_madlibToken, token, StringComparison.OrdinalIgnoreCase))?.m_madlibArgument;

            return new TallyCounterTemplate {
                m_percentChance = 1.0f,
                m_count = goalTotal,
                m_descriptor = Token("TALLYTEXT") ?? "",
                m_descriptor2 = Token("TALLYTEXT2") ?? "",
                m_tallyResults = new ResultList { m_results = [] },
            };
        }
        catch (Exception ex) when (ex is FormatException or InvalidOperationException
                                       or ArgumentException or IndexOutOfRangeException) {
            return null;
        }
    }

    private static bool IsEmptyValue(JsonNode value)
        => value is JsonValue json && json.TryGetValue<string>(out var text) && text.Length == 0;

}
