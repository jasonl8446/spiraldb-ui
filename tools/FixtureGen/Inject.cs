using Imcodec.ObjectProperty;
using Imcodec.ObjectProperty.TypeCache;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace FixtureGen;

/// <summary>
/// `--inject &lt;spec.json&gt;` (Phase 7, task 7.2, D128): plants known values into the capture so the
/// wrapper's new decoders (7.3-7.5) can be proven against values that cannot occur by accident.
///
/// The spec is strict JSON:
///
///   {
///     "description": "…",                      free text, ignored
///     "allowAchieveRank": false,               opt in to GOAL_TYPE_ACHIEVERANK (D146)
///     "goalDialogQuestId": false,              goal dialogs carry the QuestID (task 7.4)
///     "sendQuestFields": { "QuestNameID": 1 }, extra fields planted on MSG_SENDQUEST
///     "questOfferFields": { "Rewards": … },    fields planted on MSG_QUESTOFFER (task 7.5)
///     "sequence": [                            the deliberate message order, after MSG_QUESTOFFER,
///       { "message": "MSG_SENDGOAL",           MSG_SENDQUEST and the quest-level dialogs
///         "goal": 0,                           index into the corpus m_goals list
///         "fields": { "PersonaName": "…" } }   fields planted on that envelope
///     ]
///   }
///
/// `message` is one of <see cref="s_injectMessages"/>. MSG_ACTORDIALOG and MSG_ENCOUNTERDIALOG are
/// planted dialogs (task 7.4): "goal" is optional (omitted = quest-level, GoalID 0), the engine fills
/// MobileID/QuestID/GoalID and the spec must plant CompletionType and ActorDialog. A planted field is written into the envelope
/// exactly as given, whether or not Imview's message definition declares it (that is the point:
/// `MSG_SENDGOAL.PersonaName` is declared by Imlight's QuestMessages.xml but not by the reader). The
/// engine fills the ids (QuestID, and GoalID / MobileID where the message has them) and, for
/// MSG_SENDGOAL, the whole corpus goal; a planted field of the same name replaces the engine's.
/// A field value may be an object with a "$blob" key, which is serialised with Imcodec's
/// ObjectSerializer into the hex string the wire carries:
///
///   { "$blob": "ClientTagList", "tags": ["a", "b"] }              mask 1  (Prop_Save)
///   { "$blob": "LootInfoList",  "gold": 1234, "magicXp": 56 }     mask 31 (LootTableTest's mask);
///       task 7.5 adds "items": [{"id": n, "count": n}] (ItemLootInfo) and "spells": [n]
///       (AddSpellLootInfo), and an absent "gold"/"magicXp" leaves that entry out
///   { "$blob": "ActorDialog",   "entries": ["line 1", "line 2"] } mask 16 (QuestBuilder's dialog mask),
///                                                                one NPCDialogEntry per line (m_dialog)
///
/// Under --inject, MSG_SENDGOAL is emitted only where the sequence says so (every goal the
/// GoalCompilation does not carry must be sent at least once); a compilation goal may be sent too,
/// which the reader skips as a duplicate by GoalNameID. A compilation goal that carries dialogs must be
/// sent (its dialogs follow its first send). A planted MSG_SENDGOAL field replaces the engine's, so a spec
/// can plant a GoalType QuestBuilder does not list (task 7.4's unlisted-goal-type fixture).
///
/// MSG_QUESTREWARDS and MSG_LOOT (task 7.5) are the quest's reward packets: no "goal", and the spec
/// must plant LootList. The engine fills MSG_QUESTREWARDS.QuestID and MSG_LOOT.GlobalID (the player,
/// as Imlight's LootGranter sends it: MSG_LOOT carries no QuestID).
///
/// "goalDialogQuestId": true writes the quest's QuestID on the goal dialogs (the engine writes 0 by
/// default; the game server writes the quest id), which is what makes QuestBuilder attach a goal-level
/// Completion dialog to the quest as well (D46(4)).
/// </summary>
internal static partial class Program {

    private static readonly HashSet<string> s_injectMessages = [
        "MSG_SENDGOAL",
        "MSG_COMPLETEGOAL",
        "MSG_REMOVEGOAL",
        "MSG_COMPLETEQUEST",
        "MSG_PERSONAINFO",
        "MSG_ACTORDIALOG",
        "MSG_ENCOUNTERDIALOG",
        "MSG_QUESTREWARDS",
        "MSG_LOOT",
    ];

    // Planted dialogs may be quest-level, so their "goal" is optional.
    private static readonly HashSet<string> s_dialogMessages = ["MSG_ACTORDIALOG", "MSG_ENCOUNTERDIALOG"];

    // The reward packets (task 7.5) are quest-scoped: no "goal", and LootList must be planted.
    private static readonly HashSet<string> s_rewardMessages = ["MSG_QUESTREWARDS", "MSG_LOOT"];

    private const uint PropLootInfoList = 31;

    private sealed record InjectStep(string Message, int? Goal, JObject Fields);

    private sealed record InjectSpec(
        bool AllowAchieveRank, bool GoalDialogQuestId, JObject SendQuestFields, JObject QuestOfferFields,
        List<InjectStep> Sequence);

    private static bool IsOptedInAchieveRank(InjectSpec? inject, CorpusGoal goal)
        => inject is { AllowAchieveRank: true } && goal.Type == GOAL_TYPE.GOAL_TYPE_ACHIEVERANK;

    private static InjectSpec LoadInject(string path) {
        if (!File.Exists(path)) {
            throw new FixtureException($"inject spec not found: {path}");
        }

        JObject root;

        try {
            root = JObject.Parse(File.ReadAllText(path));
        }
        catch (JsonException ex) {
            throw new FixtureException($"cannot parse inject spec '{path}': {ex.Message}");
        }

        var sendQuest = new JObject();

        if (root["sendQuestFields"] is JObject planted) {
            foreach (var property in planted.Properties()) {
                sendQuest[property.Name] = ResolvePlanted(property.Value, $"'{path}': sendQuestFields.{property.Name}");
            }
        }

        var questOffer = new JObject();

        if (root["questOfferFields"] is JObject offerPlanted) {
            foreach (var property in offerPlanted.Properties()) {
                questOffer[property.Name] = ResolvePlanted(property.Value, $"'{path}': questOfferFields.{property.Name}");
            }
        }

        var sequence = new List<InjectStep>();

        if (root["sequence"] is JArray steps) {
            for (var i = 0; i < steps.Count; i++) {
                var what = $"'{path}': sequence[{i}]";

                if (steps[i] is not JObject step) {
                    throw new FixtureException($"{what} is not an object");
                }

                var message = step["message"]?.Value<string>() ?? "";
                var goal = step["goal"] is { Type: JTokenType.Integer } goalToken ? goalToken.Value<int>() : (int?) null;
                var fields = new JObject();

                if (step["fields"] is JObject stepFields) {
                    foreach (var property in stepFields.Properties()) {
                        fields[property.Name] = ResolvePlanted(property.Value, $"{what}.fields.{property.Name}");
                    }
                }

                sequence.Add(new InjectStep(message, goal, fields));
            }
        }

        return new InjectSpec(
            root["allowAchieveRank"]?.Value<bool>() ?? false,
            root["goalDialogQuestId"]?.Value<bool>() ?? false,
            sendQuest,
            questOffer,
            sequence);
    }

    /// <summary>Everything wrong with the spec against this quest's goal list, all at once.</summary>
    private static List<string> ValidateInject(
        InjectSpec inject, int goalCount, int compilationGoalCount, Func<int, bool> carriesDialogs) {
        var problems = new List<string>();
        var sent = new HashSet<int>();

        for (var i = 0; i < inject.Sequence.Count; i++) {
            var step = inject.Sequence[i];

            if (!s_injectMessages.Contains(step.Message)) {
                problems.Add($"inject sequence[{i}] message '{step.Message}' is not one of {string.Join(", ", s_injectMessages)}");
                continue;
            }

            if (step.Message == "MSG_COMPLETEQUEST") {
                continue;
            }

            if (s_rewardMessages.Contains(step.Message)) {
                if (step.Fields["LootList"] is null) {
                    problems.Add($"inject sequence[{i}] ({step.Message}) must plant LootList");
                }

                if (step.Goal is not null) {
                    problems.Add($"inject sequence[{i}] ({step.Message}) is quest-scoped and takes no \"goal\"");
                }

                continue;
            }

            if (s_dialogMessages.Contains(step.Message)) {
                foreach (var required in new[] { "CompletionType", "ActorDialog" }.Where(f => step.Fields[f] is null)) {
                    problems.Add($"inject sequence[{i}] ({step.Message}) must plant {required}");
                }

                if (step.Goal is null) {
                    continue;
                }
            }

            if (step.Goal is not { } goal || goal < 0 || goal >= goalCount) {
                problems.Add($"inject sequence[{i}] ({step.Message}) needs a \"goal\" index in 0..{goalCount - 1}");
                continue;
            }

            if (step.Message == "MSG_SENDGOAL") {
                sent.Add(goal);
            }
        }

        for (var goal = compilationGoalCount; goal < goalCount; goal++) {
            if (!sent.Contains(goal)) {
                problems.Add($"inject sequence never sends goal {goal}: it is not in the GoalCompilation, so the reader would never see it");
            }
        }

        for (var goal = 0; goal < compilationGoalCount; goal++) {
            if (carriesDialogs(goal) && !sent.Contains(goal)) {
                problems.Add($"inject sequence never sends compilation goal {goal}: it carries dialogs, which only a GoalID can attach");
            }
        }

        return problems;
    }

    /// <summary>A plain value is planted as-is; an object with "$blob" becomes the hex blob it describes.</summary>
    private static JToken ResolvePlanted(JToken value, string what) {
        if (value is not JObject { } spec || spec["$blob"] is null) {
            return value.DeepClone();
        }

        var kind = spec["$blob"]!.Value<string>();

        switch (kind) {
            case "ClientTagList": {
                var tags = (spec["tags"] as JArray)?.Select(t => t.Value<string>() ?? "").ToList() ?? [];
                return SerializeBlob(new ClientTagList { m_clientTags = tags }, PropSave, $"ClientTagList({what})");
            }

            case "LootInfoList": {
                var gold = spec["gold"]?.Value<int>();
                var magicXp = spec["magicXp"]?.Value<int>();
                var items = (spec["items"] as JArray)?
                    .Select(t => (Id: t["id"]?.Value<ulong>() ?? 0, Count: t["count"]?.Value<int>() ?? 1)).ToList() ?? [];
                var spells = (spec["spells"] as JArray)?.Select(t => t.Value<uint>()).ToList() ?? [];
                var loot = new List<LootInfo>();
                if (magicXp is { } experience) {
                    loot.Add(new MagicXPLootInfo { m_lootType = LOOT_TYPE.LOOT_TYPE_MAGIC_XP, m_experience = experience });
                }

                loot.AddRange(items.Select(item => (LootInfo) new ItemLootInfo {
                    m_lootType = LOOT_TYPE.LOOT_TYPE_ITEM, m_itemID = item.Id, m_numItems = item.Count,
                }));
                loot.AddRange(spells.Select(spell => (LootInfo) new AddSpellLootInfo {
                    m_lootType = LOOT_TYPE.LOOT_TYPE_ADD_SPELL, m_spellID = spell,
                }));
                var list = new LootInfoList {
                    m_loot = loot,
                    m_goldInfo = gold is { } amount
                        ? new GoldLootInfo { m_lootType = LOOT_TYPE.LOOT_TYPE_GOLD, m_goldAmount = amount }
                        : null,
                };
                var hex = SerializeBlob(list, PropLootInfoList, $"LootInfoList({what})");
                SelfCheckLootInfoList(hex, gold, magicXp, items, spells, what);
                return hex;
            }

            case "ActorDialog": {
                var lines = (spec["entries"] as JArray)?.Select(t => t.Value<string>() ?? "").ToList() ?? [];
                var dialog = new ActorDialog {
                    m_dialogTag = "",
                    m_dialogEntries = [.. lines.Select(line => (ActorDialogEntry) new NPCDialogEntry { m_dialog = line })],
                    m_madlibs = [],
                    m_dialogEvents = [],
                };
                var hex = SerializeBlob(dialog, PropAuthorityTransmit, $"ActorDialog({what})");
                SelfCheckPlantedDialog(hex, lines, what);
                return hex;
            }

            default:
                throw new FixtureException($"{what}: unknown $blob kind '{kind}' (ClientTagList, LootInfoList, ActorDialog)");
        }
    }

    private static void SelfCheckPlantedDialog(string blob, List<string> lines, string what) {
        var serializer = new ObjectSerializer(Versionable: false, Behaviors: SerializerFlags.None);

        if (!serializer.Deserialize<ActorDialog>(Convert.FromHexString(blob), PropAuthorityTransmit, out var decoded)
            || decoded?.m_dialogEntries is not { } entries
            || !entries.Select(e => (e as NPCDialogEntry)?.m_dialog ?? "").SequenceEqual(lines)) {
            throw new FixtureException($"self-check: the ActorDialog blob for {what} did not round-trip its {lines.Count} line(s)");
        }
    }

    private static void SelfCheckLootInfoList(
        string blob, int? gold, int? magicXp, List<(ulong Id, int Count)> items, List<uint> spells, string what) {
        var serializer = new ObjectSerializer(Versionable: false, Behaviors: SerializerFlags.None);

        if (!serializer.Deserialize<LootInfoList>(Convert.FromHexString(blob), (PropertyFlags) PropLootInfoList, out var decoded)
            || decoded?.m_goldInfo?.m_goldAmount != gold
            || decoded.m_loot is not { } loot
            || !loot.OfType<MagicXPLootInfo>().Select(x => (int?) x.m_experience)
                .SequenceEqual(magicXp is null ? [] : [magicXp])
            || !loot.OfType<ItemLootInfo>().Select(x => (x.m_itemID.Full, x.m_numItems)).SequenceEqual(items)
            || !loot.OfType<AddSpellLootInfo>().Select(x => x.m_spellID).SequenceEqual(spells)
            || loot.Count != (magicXp is null ? 0 : 1) + items.Count + spells.Count) {
            throw new FixtureException(
                $"self-check: the LootInfoList blob for {what} did not round-trip (gold {gold}, magic xp {magicXp}, "
                + $"{items.Count} item(s), {spells.Count} spell(s))");
        }
    }
}
