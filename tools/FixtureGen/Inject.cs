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
///     "sendQuestFields": { "QuestNameID": 1 }, extra fields planted on MSG_SENDQUEST
///     "sequence": [                            the deliberate message order, after MSG_QUESTOFFER,
///       { "message": "MSG_SENDGOAL",           MSG_SENDQUEST and the quest-level dialogs
///         "goal": 0,                           index into the corpus m_goals list
///         "fields": { "PersonaName": "…" } }   fields planted on that envelope
///     ]
///   }
///
/// `message` is one of <see cref="s_injectMessages"/>. A planted field is written into the envelope
/// exactly as given, whether or not Imview's message definition declares it (that is the point:
/// `MSG_SENDGOAL.PersonaName` is declared by Imlight's QuestMessages.xml but not by the reader). The
/// engine fills the ids (QuestID, and GoalID / MobileID where the message has them) and, for
/// MSG_SENDGOAL, the whole corpus goal; a planted field of the same name replaces the engine's.
/// A field value may be an object with a "$blob" key, which is serialised with Imcodec's
/// ObjectSerializer into the hex string the wire carries:
///
///   { "$blob": "ClientTagList", "tags": ["a", "b"] }              mask 1  (Prop_Save)
///   { "$blob": "LootInfoList",  "gold": 1234, "magicXp": 56 }     mask 31 (LootTableTest's mask)
///
/// Under --inject, MSG_SENDGOAL is emitted only where the sequence says so (every goal the
/// GoalCompilation does not carry must be sent at least once); a compilation goal may be sent too,
/// which the reader skips as a duplicate by GoalNameID.
/// </summary>
internal static partial class Program {

    private static readonly HashSet<string> s_injectMessages = [
        "MSG_SENDGOAL",
        "MSG_COMPLETEGOAL",
        "MSG_REMOVEGOAL",
        "MSG_COMPLETEQUEST",
        "MSG_PERSONAINFO",
    ];

    private const uint PropLootInfoList = 31;

    private sealed record InjectStep(string Message, int? Goal, JObject Fields);

    private sealed record InjectSpec(bool AllowAchieveRank, JObject SendQuestFields, List<InjectStep> Sequence);

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

        return new InjectSpec(root["allowAchieveRank"]?.Value<bool>() ?? false, sendQuest, sequence);
    }

    /// <summary>Everything wrong with the spec against this quest's goal list, all at once.</summary>
    private static List<string> ValidateInject(InjectSpec inject, int goalCount, int compilationGoalCount) {
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
                var gold = spec["gold"]?.Value<int>() ?? 0;
                var magicXp = spec["magicXp"]?.Value<int>() ?? 0;
                var list = new LootInfoList {
                    m_loot = [new MagicXPLootInfo { m_lootType = LOOT_TYPE.LOOT_TYPE_MAGIC_XP, m_experience = magicXp }],
                    m_goldInfo = new GoldLootInfo { m_lootType = LOOT_TYPE.LOOT_TYPE_GOLD, m_goldAmount = gold },
                };
                var hex = SerializeBlob(list, PropLootInfoList, $"LootInfoList({what})");
                SelfCheckLootInfoList(hex, gold, magicXp, what);
                return hex;
            }

            default:
                throw new FixtureException($"{what}: unknown $blob kind '{kind}' (ClientTagList, LootInfoList)");
        }
    }

    private static void SelfCheckLootInfoList(string blob, int gold, int magicXp, string what) {
        var serializer = new ObjectSerializer(Versionable: false, Behaviors: SerializerFlags.None);

        if (!serializer.Deserialize<LootInfoList>(Convert.FromHexString(blob), (PropertyFlags) PropLootInfoList, out var decoded)
            || decoded?.m_goldInfo is null
            || decoded.m_goldInfo.m_goldAmount != gold
            || decoded.m_loot is not [MagicXPLootInfo { } xp]
            || xp.m_experience != magicXp) {
            throw new FixtureException($"self-check: the LootInfoList blob for {what} did not round-trip (gold {gold}, magic xp {magicXp})");
        }
    }
}
