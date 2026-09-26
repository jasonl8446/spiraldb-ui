using System.Text;
using Imcodec.IO;
using Imcodec.ObjectProperty;
using Imcodec.ObjectProperty.TypeCache;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;

namespace FixtureGen;

/// <summary>
/// Manufactures a packet-capture file (the input <see cref="Imview.PacketReader.QuestBuilder"/>
/// consumes) from a real SpiralDB corpus quest, so the Phase 2 quest-extraction round trip can be
/// tested without recorded captures (plan task 2.1a, decision D28).
///
/// The envelope and the hex blobs are written exactly the way the reader decodes them:
///   * envelope:                    [{"data":{"name":"MSG_…","fields":{ F:{"value":V} }}}] (every field wrapped)
///   * MSG_QUESTOFFER.GoalData    -> GoalCompilation  mask 1  (QuestBuilder.ExtractGoalCompilationFromPacket)
///   * MSG_SENDGOAL.ClientTags    -> ClientTagList    mask 1  (QuestBuilder.cs L160)
///   * MSG_SENDGOAL.GoalMadlibs   -> MadlibBlock      mask 1  (QuestBuilder.ParseTallyCounterFromMadlibs)
///   * MSG_ACTORDIALOG.ActorDialog -> ActorDialog     mask 16 (QuestBuilder.cs L245/L314/L373)
/// All four use `new ObjectSerializer(false, SerializerFlags.None)`; the masks are PropertyFlags
/// values (Prop_Save = 1, Prop_AuthorityTransmit = 16), not byte offsets.
///
/// Goal placement — why GoalData carries only a prefix of the goals: QuestBuilder names goals
/// `"{n}_{m_goalTitle}"`, numbering compilation goals 1..k and then continuing with the goals it
/// adds from MSG_SENDGOAL packets. The corpus' `m_startGoals` is a prefix of `m_goals` in all 322
/// quests, so the faithful split is compilation = `m_startGoals`, packets = the remainder. A goal
/// the compilation already produced makes the reader skip the matching packet *and* leaves the
/// GoalID→goal map empty, so a goal-level dialog only survives on a packet-delivered goal — that
/// is enforced below and never papered over.
/// </summary>
internal static class Program {

    private const uint PropSave = 1;
    private const uint PropAuthorityTransmit = 16;

    // QuestBuilder.GetGoalFromType supports exactly these (QuestBuilder.cs L484-494); anything else
    // makes the CLI throw NotSupportedException, so refuse to emit it here instead.
    private static readonly HashSet<GOAL_TYPE> s_supportedGoalTypes = [
        GOAL_TYPE.GOAL_TYPE_BOUNTY,
        GOAL_TYPE.GOAL_TYPE_BOUNTYCOLLECT,
        GOAL_TYPE.GOAL_TYPE_SCAVENGE,
        GOAL_TYPE.GOAL_TYPE_USAGE,
        GOAL_TYPE.GOAL_TYPE_PERSONA,
        GOAL_TYPE.GOAL_TYPE_WAYPOINT,
        GOAL_TYPE.GOAL_TYPE_ACHIEVERANK,
    ];

    // Only dialogs are materialised into Imcodec types (they become hex blobs); the rest of the
    // corpus is read as a JObject so that a $type the codebase does not know (the corpus references
    // ResLearnSpell, which exists in neither the client nor the server type registry) cannot abort
    // generation of an otherwise fine fixture.
    private static readonly JsonSerializerSettings s_entitySettings = new() {
        TypeNameHandling = TypeNameHandling.Auto,
        NullValueHandling = NullValueHandling.Ignore,
        Converters = { new StringEnumConverter() },
    };

    private const string Usage = """
        Usage: fixturegen --quest <path> --output <capture.json> [--persona <name>]

        Generates an Imview packet capture from a SpiralDB corpus QuestTemplate so that
        `imview-packet-reader` reconstructs the same quest. Nothing is written to stdout; the
        summary and any error go to stderr.

        Options:
          --quest   <path>   Corpus quest JSON (JSON5/trailing commas tolerated) (required).
          --output  <path>   Capture file to write, strict JSON (required).
          --persona <name>   Value for the MSG_ACTORDIALOG Persona field. Default "" keeps the
                             committed fixtures independent of the template manifest; a non-empty
                             persona is safe now that the CLI keeps the reader's diagnostics off
                             stdout (decision D46).
          -h, --help         Show this help and exit.

        Exit codes: 0 = capture written, 1 = refused to write (message on stderr).
        """;

    private static int Main(string[] args) {
        if (!TryParseArguments(args, out var options, out var argumentError)) {
            Console.Error.WriteLine(argumentError);
            Console.Error.WriteLine();
            Console.Error.WriteLine(Usage);
            return 1;
        }

        if (options.Help) {
            Console.Error.WriteLine(Usage);
            return 0;
        }

        try {
            Console.Error.WriteLine(Generate(options));
            return 0;
        }
        catch (FixtureException ex) {
            Console.Error.WriteLine($"error: {ex.Message}");
            return 1;
        }
        catch (Exception ex) {
            // Anything unexpected (a corpus blob the type cache cannot materialise, a broken
            // encode, …) is reported instead of half-written.
            Console.Error.WriteLine($"error: {Describe(ex)}");
            return 1;
        }
    }

    private static string Generate(Options options) {
        var quest = LoadQuest(options.QuestPath);

        // ---- validations (all reported at once; nothing is written when any fails) ----------
        var problems = new List<string>();

        if (string.IsNullOrEmpty(quest.Name)) {
            problems.Add("quest has an empty m_questName");
        }

        if (quest.Goals.Count == 0) {
            problems.Add("quest has no goals");
        }

        for (var i = 0; i < quest.Goals.Count; i++) {
            var goal = quest.Goals[i];
            var expectedName = $"{i + 1}_{goal.Title}";

            if (!string.Equals(goal.Name, expectedName, StringComparison.Ordinal)) {
                problems.Add(
                    $"goal[{i}] m_goalName '{goal.Name}' is not '{expectedName}': QuestBuilder derives the "
                    + "goal name as \"{n}_{m_goalTitle}\", so this quest cannot round-trip on goal names "
                    + "(every GOAL_TYPE_ACHIEVERANK quest in the corpus has an empty m_goalTitle and hits "
                    + "exactly this).");
            }

            if (!s_supportedGoalTypes.Contains(goal.Type)) {
                problems.Add($"goal[{i}] type {goal.Type} is not supported by QuestBuilder.GetGoalFromType");
            }

            if (goal.NameId == 0) {
                problems.Add(
                    $"goal[{i}] has m_goalNameID 0: a packet-delivered goal would be skipped by "
                    + "QuestBuilder's duplicate check (and the first one would swallow the rest).");
            }
        }

        for (var i = 0; i < Math.Min(quest.StartGoals.Count, quest.Goals.Count); i++) {
            if (!string.Equals(quest.StartGoals[i], quest.Goals[i].Name, StringComparison.Ordinal)) {
                problems.Add(
                    $"m_startGoals[{i}] '{quest.StartGoals[i]}' does not match m_goals[{i}].m_goalName "
                    + $"'{quest.Goals[i].Name}': the compilation-prefix assumption does not hold.");
            }
        }

        foreach (var duplicate in quest.Goals.GroupBy(g => g.NameId).Where(g => g.Count() > 1).Select(g => g.Key)) {
            problems.Add(
                $"m_goalNameID {duplicate} appears on more than one goal: QuestBuilder skips a packet "
                + "whose GoalNameID is already present, which would shift every later goal name.");
        }

        foreach (var dialog in quest.QuestDialogs) {
            var tag = dialog.m_dialogTag ?? "";

            if (!tag.Equals("Prep", StringComparison.OrdinalIgnoreCase)
                && !tag.Equals("Completion", StringComparison.OrdinalIgnoreCase)) {
                problems.Add(
                    $"quest-level dialog tag '{tag}' is not representable: QuestBuilder only attaches "
                    + "quest-level dialogs from a MSG_ACTORDIALOG with CompletionType 'QuestInfo' (tag Prep) "
                    + "or 'Completion' (tag Completion) — and only the first of each.");
            }
        }

        foreach (var tag in quest.QuestDialogs.Select(d => d.m_dialogTag ?? "").Distinct()) {
            if (quest.QuestDialogs.Count(d => (d.m_dialogTag ?? "").Equals(tag, StringComparison.OrdinalIgnoreCase)) > 1) {
                problems.Add(
                    $"two quest-level dialogs share tag '{tag}': QuestBuilder replaces instead of adding, "
                    + "so one dialog block (and its entries) would be lost.");
            }
        }

        // Goal-level dialogs can only land on a packet-delivered goal (see class remarks).
        for (var i = 0; i < quest.Goals.Count; i++) {
            if (quest.Goals[i].Dialogs.Count > 0 && i < quest.StartGoals.Count) {
                problems.Add(
                    $"goal[{i}] '{quest.Goals[i].Name}' carries dialogs but is delivered from the "
                    + $"GoalCompilation (m_startGoals has {quest.StartGoals.Count} entries): QuestBuilder "
                    + "cannot attach a dialog to a compilation goal.");
            }

            // A goal dialog whose CompletionType is "QuestInfo" would also satisfy
            // AddPrepDialogToQuestTemplate (which matches on CompletionType + MobileID, not on
            // GoalID), so it would be copied onto the quest as a Prep dialog.
            foreach (var dialog in quest.Goals[i].Dialogs.Where(d =>
                         (d.m_dialogTag ?? "").Equals("QuestInfo", StringComparison.OrdinalIgnoreCase))) {
                problems.Add(
                    $"goal[{i}] '{quest.Goals[i].Name}' carries a dialog tagged 'QuestInfo': that "
                    + "CompletionType also matches QuestBuilder's quest-level prep matcher, which "
                    + "ignores GoalID, so the dialog would appear at quest level as well.");
            }
        }

        if (problems.Count > 0) {
            throw new FixtureException(
                $"refusing to generate a capture from '{options.QuestPath}' — {problems.Count} problem(s):\n"
                + string.Join("\n", problems.Select(p => $"  - {p}")));
        }

        // ---- build the capture -----------------------------------------------------------------
        var mobileId = StableId(quest.Name, "mobile");
        var questId = StableId(quest.Name, "quest");
        var compilationGoals = quest.Goals.Take(quest.StartGoals.Count).ToList();
        var packetGoals = quest.Goals.Skip(quest.StartGoals.Count).ToList();

        var packets = new JArray();
        var notes = new List<string>();

        // MSG_QUESTOFFER: carries the starting-goal compilation (the GoalData blob).
        var goalDataHex = SerializeBlob(
            new GoalCompilation { m_goals = [.. compilationGoals.Select(ToGoalEntryFull)] },
            PropSave,
            "GoalCompilation");
        SelfCheckGoalCompilation(goalDataHex, compilationGoals, notes);

        packets.Add(Envelope("MSG_QUESTOFFER", new JObject {
            ["MobileID"] = Wrap(mobileId),
            ["QuestName"] = Wrap(quest.Name),
            ["QuestTitle"] = Wrap(quest.Title),
            ["QuestInfo"] = Wrap(quest.Info),
            ["Level"] = Wrap(quest.Level),
            // QuestBuilder never reads Rewards, and the corpus m_endResults can reference types the
            // type cache does not have (ResLearnSpell), so this stays empty.
            ["Rewards"] = Wrap(""),
            ["GoalData"] = Wrap(goalDataHex),
            ["Mainline"] = Wrap(quest.Mainline ? 1 : 0),
        }));

        // MSG_SENDQUEST: lets the reader map QuestTitle -> QuestID, which the completion dialog and
        // every goal packet are matched against.
        packets.Add(Envelope("MSG_SENDQUEST", new JObject {
            ["QuestID"] = Wrap(questId),
            ["QuestTitle"] = Wrap(quest.Title),
        }));

        // MSG_SENDGOAL: every goal the compilation does not already carry.
        var goalIds = new List<ulong>();
        var tallyGoals = 0;
        var clientTagGoals = 0;

        for (var i = 0; i < packetGoals.Count; i++) {
            var goal = packetGoals[i];
            var goalId = StableId($"{quest.Name}#{quest.StartGoals.Count + i}", "goal");
            goalIds.Add(goalId);

            var useTally = 0;
            var madlibsHex = "";

            // Fourth blob of the pipeline: rebuild the TALLYTEXT madlib block that
            // QuestBuilder.ParseTallyCounterFromMadlibs reads when UseTally == 1.
            if (goal.TallyDescriptor.Length > 0 || goal.TallyDescriptor2.Length > 0) {
                madlibsHex = SerializeBlob(
                    new MadlibBlock {
                        m_blockToken = "",
                        m_madlibs = [
                            new MadlibArgT_ByteString { m_madlibToken = "TALLYTEXT", m_madlibArgument = goal.TallyDescriptor },
                            new MadlibArgT_ByteString { m_madlibToken = "TALLYTEXT2", m_madlibArgument = goal.TallyDescriptor2 },
                        ],
                    },
                    PropSave,
                    $"MadlibBlock({goal.Name})");
                useTally = 1;
                tallyGoals++;
            }

            var clientTagsHex = "";

            if (goal.ClientTags.Count > 0) {
                clientTagsHex = SerializeBlob(
                    new ClientTagList { m_clientTags = [.. goal.ClientTags] }, PropSave, $"ClientTagList({goal.Name})");
                clientTagGoals++;
            }

            packets.Add(Envelope("MSG_SENDGOAL", new JObject {
                ["QuestID"] = Wrap(questId),
                ["GoalID"] = Wrap(goalId),
                ["GoalNameID"] = Wrap(goal.NameId),
                ["GoalTitle"] = Wrap(goal.Title),
                ["GoalLocation"] = Wrap(goal.LocationName),
                ["GoalDestinationZone"] = Wrap(goal.DestinationZone),
                ["GoalImage1"] = Wrap(goal.Image1),
                // GoalImage2 is declared Hex, but PacketReaderService never hex-decodes it — it is
                // copied into m_displayImage2 verbatim, so the plain corpus string is correct here.
                ["GoalImage2"] = Wrap(goal.Image2),
                ["GoalType"] = Wrap((byte) (int) goal.Type),
                ["GoalTotal"] = Wrap((uint) goal.GoalTotal),
                ["ClientTags"] = Wrap(clientTagsHex),
                ["NoQuestHelper"] = Wrap(goal.NoQuestHelper ? 1 : 0),
                ["PetOnlyQuest"] = Wrap(goal.PetOnlyQuest ? 1 : 0),
                ["UseTally"] = Wrap((byte) useTally),
                ["GoalMadlibs"] = Wrap(madlibsHex),
            }));
        }

        // MSG_ACTORDIALOG: one packet per corpus dialog, in corpus order (quest level first, then
        // per goal). Each blob is the corpus ActorDialog re-serialized with mask 16.
        foreach (var dialog in quest.QuestDialogs) {
            var isPrep = (dialog.m_dialogTag ?? "").Equals("Prep", StringComparison.OrdinalIgnoreCase);
            var blob = SerializeBlob(dialog, PropAuthorityTransmit, $"ActorDialog({quest.Name}/{dialog.m_dialogTag})");
            SelfCheckActorDialog(blob, dialog, notes);

            packets.Add(Envelope("MSG_ACTORDIALOG", ActorDialogFields(
                mobileId, questId, 0, isPrep ? "QuestInfo" : "Completion", blob, options.Persona)));
        }

        for (var i = 0; i < packetGoals.Count; i++) {
            foreach (var dialog in packetGoals[i].Dialogs) {
                var blob = SerializeBlob(
                    dialog, PropAuthorityTransmit, $"ActorDialog({packetGoals[i].Name}/{dialog.m_dialogTag})");
                SelfCheckActorDialog(blob, dialog, notes);

                // QuestID is 0 on a goal-scoped dialog on purpose: AddCompletionDialogToQuestTemplate
                // matches on CompletionType == "Completion" && QuestID == quest.Id and *ignores*
                // GoalID, so writing the quest id here makes QuestBuilder copy the first goal-level
                // Completion dialog onto the quest as a second (bogus) quest-level dialog.
                // AddDialogToGoals only needs GoalID, so nothing is lost.
                packets.Add(Envelope("MSG_ACTORDIALOG", ActorDialogFields(
                    mobileId, 0, goalIds[i], dialog.m_dialogTag ?? "", blob, options.Persona)));
            }
        }

        WriteAtomically(options.OutputPath, packets.ToString(Formatting.Indented));

        var dialogBlocks = quest.QuestDialogs.Count + quest.Goals.Sum(g => g.Dialogs.Count);
        var dialogEntries = quest.QuestDialogs.Sum(d => d.m_dialogEntries?.Count ?? 0)
            + quest.Goals.Sum(g => g.Dialogs.Sum(d => d.m_dialogEntries?.Count ?? 0));

        var summary = new StringBuilder();
        summary.AppendLine($"fixturegen: {options.QuestPath}");
        summary.AppendLine(FormattableString.Invariant(
            $"  quest            {quest.Name}  title={quest.Title}  level={quest.Level}  mainline={quest.Mainline}"));
        summary.AppendLine(FormattableString.Invariant(
            $"  goals            {quest.Goals.Count} total = {compilationGoals.Count} in GoalCompilation (m_startGoals) + {packetGoals.Count} via MSG_SENDGOAL"));
        summary.AppendLine(FormattableString.Invariant(
            $"  dialogs          {dialogBlocks} block(s) / {dialogEntries} dialog entry(ies); {quest.QuestDialogs.Count} quest-level, {dialogBlocks - quest.QuestDialogs.Count} goal-level"));
        summary.AppendLine(FormattableString.Invariant(
            $"  packets          {packets.Count} ({packetGoals.Count} MSG_SENDGOAL, {dialogBlocks} MSG_ACTORDIALOG); tally madlib blobs: {tallyGoals}, client-tag blobs: {clientTagGoals}"));
        summary.AppendLine(FormattableString.Invariant(
            $"  ids              MobileID={mobileId} QuestID={questId}"));
        summary.AppendLine($"  output           {Path.GetFullPath(options.OutputPath)}");

        foreach (var note in notes) {
            summary.AppendLine($"  self-check       {note}");
        }

        return summary.ToString().TrimEnd();
    }

    private static JObject ActorDialogFields(
        ulong mobileId, ulong questId, ulong goalId, string completionType, string blob, string persona)
        => new() {
            ["MobileID"] = Wrap(mobileId),
            ["QuestID"] = Wrap(questId),
            ["GoalID"] = Wrap(goalId),
            ["CompletionType"] = Wrap(completionType),
            ["ActorDialog"] = Wrap(blob),
            ["Persona"] = Wrap(persona),
            ["PersonaName"] = Wrap(""),
            ["PersonaIcon"] = Wrap(""),
            ["RangeCheck"] = Wrap(0),
            ["IsEncounter"] = Wrap(0),
            ["DefaultDialogAnimation"] = Wrap(""),
        };

    private sealed record CorpusGoal(
        string Name,
        uint NameId,
        string Title,
        GOAL_TYPE Type,
        string LocationName,
        string DestinationZone,
        string Image1,
        string Image2,
        int GoalTotal,
        string PersonaName,
        bool NoQuestHelper,
        bool PetOnlyQuest,
        List<string> ClientTags,
        string TallyDescriptor,
        string TallyDescriptor2,
        List<ActorDialog> Dialogs);

    private sealed record CorpusQuest(
        string Name,
        string Title,
        string Info,
        int Level,
        bool Mainline,
        List<string> StartGoals,
        List<CorpusGoal> Goals,
        List<ActorDialog> QuestDialogs);

    private static CorpusQuest LoadQuest(string path) {
        if (!File.Exists(path)) {
            throw new FixtureException($"quest file not found: {path}");
        }

        JObject root;

        try {
            root = JObject.Parse(File.ReadAllText(path));
        }
        catch (JsonException ex) {
            throw new FixtureException($"cannot parse '{path}': {ex.Message}");
        }

        var goals = new List<CorpusGoal>();

        if (root["m_goals"] is JArray goalArray) {
            for (var i = 0; i < goalArray.Count; i++) {
                if (goalArray[i] is not JObject goal) {
                    throw new FixtureException($"'{path}': m_goals[{i}] is not an object");
                }

                var typeName = Str(goal, "m_goalType");

                if (!Enum.TryParse<GOAL_TYPE>(typeName, ignoreCase: false, out var goalType)
                    || !Enum.IsDefined(goalType)) {
                    throw new FixtureException($"'{path}': m_goals[{i}].m_goalType '{typeName}' is not a GOAL_TYPE name");
                }

                var tally = goal["m_tallyCounter"] as JObject;
                // Only the Bounty* templates carry m_bountyTotal, and only they are built as
                // BountyGoalTemplate by the reader.
                var isBounty = goalType is GOAL_TYPE.GOAL_TYPE_BOUNTY or GOAL_TYPE.GOAL_TYPE_BOUNTYCOLLECT;

                goals.Add(new CorpusGoal(
                    Name: Str(goal, "m_goalName"),
                    NameId: Uint(goal, "m_goalNameID"),
                    Title: Str(goal, "m_goalTitle"),
                    Type: goalType,
                    LocationName: Str(goal, "m_locationName"),
                    DestinationZone: Str(goal, "m_destinationZone"),
                    Image1: Str(goal, "m_displayImage1"),
                    Image2: Str(goal, "m_displayImage2"),
                    GoalTotal: isBounty ? Int(goal, "m_bountyTotal") : 0,
                    PersonaName: Str(goal, "m_personaName"),
                    NoQuestHelper: Bool(goal, "m_noQuestHelper"),
                    PetOnlyQuest: Bool(goal, "m_petOnlyQuest"),
                    ClientTags: StrList(goal, "m_clientTags"),
                    TallyDescriptor: tally is null ? "" : Str(tally, "m_descriptor"),
                    TallyDescriptor2: tally is null ? "" : Str(tally, "m_descriptor2"),
                    Dialogs: LoadDialogs(goal, $"'{path}': m_goals[{i}]")));
            }
        }

        return new CorpusQuest(
            Name: Str(root, "m_questName"),
            Title: Str(root, "m_questTitle"),
            Info: root["m_questInfo"] is null or { Type: JTokenType.Null } ? "" : Str(root, "m_questInfo"),
            Level: Int(root, "m_questLevel"),
            Mainline: Bool(root, "m_mainline"),
            StartGoals: StrList(root, "m_startGoals"),
            Goals: goals,
            QuestDialogs: LoadDialogs(root, $"'{path}': quest level"));
    }

    private static List<ActorDialog> LoadDialogs(JObject owner, string what) {
        if (owner["m_dialogList"] is not JObject list || list["m_dialogs"] is not JArray dialogs) {
            return [];
        }

        var serializer = JsonSerializer.Create(s_entitySettings);
        var result = new List<ActorDialog>();

        foreach (var token in dialogs) {
            try {
                result.Add(token.ToObject<ActorDialog>(serializer)
                    ?? throw new JsonException("the token deserialized to null"));
            }
            catch (JsonException ex) {
                throw new FixtureException($"cannot materialise {what} dialog as ActorDialog: {ex.Message}");
            }
        }

        return result;
    }

    /// <summary>Corpus goal -> the GoalEntryFull the GoalCompilation blob carries.</summary>
    private static GoalEntryFull ToGoalEntryFull(CorpusGoal goal) => new() {
        m_goalTitle = goal.Title,
        m_goalNameID = goal.NameId,
        m_goalType = (int) goal.Type,
        // The corpus calls it m_locationName; the compilation calls it m_goalLocation.
        m_goalLocation = goal.LocationName,
        m_goalDestinationZone = goal.DestinationZone,
        m_goalImage1 = goal.Image1,
        m_goalImage2 = goal.Image2,
        m_goalTotal = goal.GoalTotal,
        m_clientTags = [.. goal.ClientTags],
        m_personaName = goal.Type == GOAL_TYPE.GOAL_TYPE_PERSONA ? goal.PersonaName : "",
        m_questTitle = "",
    };

    /// <summary>
    /// Mirrors <see cref="ObjectSerializer.Serialize(PropertyClass, uint, out ByteString)"/>
    /// (Versionable=false, no serializer flags, raw bytes, no header — the same call
    /// Imview.Core/Services/TemplateSerializerService.cs L130 uses), with one deliberate fix:
    /// <see cref="BitWriter.GetData"/> ignores a pending partial byte, so an object whose encoding
    /// ends in <c>WriteBit</c> (ActorDialog ends with m_noAggroWhileDialogIsUp/m_noAggroNoDelay)
    /// silently loses its trailing bits. Zero-padding the bit accumulator to a byte boundary flushes
    /// them into the stream instead.
    /// </summary>
    private static string SerializeBlob(PropertyClass value, uint mask, string what) {
        var serializer = new ObjectSerializer(Versionable: false, Behaviors: SerializerFlags.None) {
            PropertyMask = (PropertyFlags) mask,
        };

        var writer = new BitWriter();

        if (!serializer.PreWriteObject(writer, value)) {
            throw new FixtureException($"serialize {what}: PreWriteObject failed");
        }

        if (!value.Encode(writer, serializer)) {
            throw new FixtureException($"serialize {what}: Encode failed");
        }

        var pendingBits = (8 - (writer.BitPos() % 8)) % 8;

        if (pendingBits > 0) {
            writer.WriteBits((byte) 0, pendingBits);
        }

        return Convert.ToHexString(writer.GetData());
    }

    /// <summary>Decodes what was just written the way QuestBuilder does, so a bad blob never ships.</summary>
    private static void SelfCheckGoalCompilation(string blob, List<CorpusGoal> expected, List<string> notes) {
        var serializer = new ObjectSerializer(Versionable: false, Behaviors: SerializerFlags.None);

        if (!serializer.Deserialize<GoalCompilation>(Convert.FromHexString(blob), PropSave, out var decoded)
            || decoded is null) {
            throw new FixtureException("self-check: the GoalCompilation blob did not decode");
        }

        var actual = decoded.m_goals ?? [];

        if (actual.Count != expected.Count) {
            throw new FixtureException(
                $"self-check: GoalCompilation decoded {actual.Count} goals, wrote {expected.Count}");
        }

        for (var i = 0; i < expected.Count; i++) {
            var want = expected[i];
            var got = actual[i];

            if (got is null
                || got.m_goalTitle != want.Title
                || got.m_goalNameID != want.NameId
                || got.m_goalType != (int) want.Type
                || got.m_goalLocation != want.LocationName
                || got.m_goalDestinationZone != want.DestinationZone) {
                throw new FixtureException($"self-check: GoalCompilation goal[{i}] did not survive the round trip");
            }
        }

        notes.Add(FormattableString.Invariant(
            $"GoalCompilation blob ({blob.Length / 2} bytes) decodes to {actual.Count} goal(s) identical to the corpus goals"));
    }

    private static void SelfCheckActorDialog(string blob, ActorDialog expected, List<string> notes) {
        var serializer = new ObjectSerializer(Versionable: false, Behaviors: SerializerFlags.None);

        if (!serializer.Deserialize<ActorDialog>(Convert.FromHexString(blob), PropAuthorityTransmit, out var decoded)
            || decoded is null) {
            throw new FixtureException($"self-check: the ActorDialog blob for tag '{expected.m_dialogTag}' did not decode");
        }

        var wantEntries = expected.m_dialogEntries?.Count ?? 0;
        var gotEntries = decoded.m_dialogEntries?.Count ?? 0;

        if (wantEntries != gotEntries) {
            throw new FixtureException(
                $"self-check: ActorDialog '{expected.m_dialogTag}' decoded {gotEntries} entries, wrote {wantEntries}");
        }

        if (decoded.m_noAggroNoDelay != expected.m_noAggroNoDelay
            || decoded.m_noAggroWhileDialogIsUp != expected.m_noAggroWhileDialogIsUp) {
            throw new FixtureException(
                $"self-check: ActorDialog '{expected.m_dialogTag}' lost its trailing no-aggro flags "
                + $"({decoded.m_noAggroWhileDialogIsUp}/{decoded.m_noAggroNoDelay} != "
                + $"{expected.m_noAggroWhileDialogIsUp}/{expected.m_noAggroNoDelay})");
        }

        if (notes.Count < 4) {
            notes.Add(FormattableString.Invariant(
                $"ActorDialog '{expected.m_dialogTag}' blob ({blob.Length / 2} bytes) decodes to {gotEntries} entry(ies), trailing flags intact"));
        }
    }

    private static void WriteAtomically(string path, string contents) {
        var fullPath = Path.GetFullPath(path);
        var directory = Path.GetDirectoryName(fullPath);

        if (!string.IsNullOrEmpty(directory)) {
            Directory.CreateDirectory(directory);
        }

        // Never leave a partial capture behind: render fully, write a sibling temp file, then move.
        var temp = fullPath + ".tmp";
        File.WriteAllText(temp, contents);
        File.Move(temp, fullPath, overwrite: true);
    }

    private static JObject Envelope(string packetName, JObject fields)
        => new() { ["data"] = new JObject { ["name"] = packetName, ["fields"] = fields } };

    /// <summary>PacketReaderService reads every field through node["value"], so wrap them all.</summary>
    private static JObject Wrap(object value) => new() { ["value"] = JToken.FromObject(value) };

    /// <summary>Deterministic ids (FNV-1a 64, high bit cleared) so regenerating is byte-identical.</summary>
    private static ulong StableId(string text, string kind) {
        var hash = 14695981039346656037UL;

        foreach (var b in Encoding.UTF8.GetBytes($"{kind}:{text}")) {
            hash ^= b;
            hash *= 1099511628211UL;
        }

        return (hash & 0x7FFF_FFFF_FFFF_FFFFUL) | 1UL;
    }

    private static string Str(JObject owner, string key)
        => owner[key] is null or { Type: JTokenType.Null } ? "" : owner[key]!.Value<string>() ?? "";

    private static int Int(JObject owner, string key)
        => owner[key] is null or { Type: JTokenType.Null } ? 0 : owner[key]!.Value<int>();

    private static uint Uint(JObject owner, string key)
        => owner[key] is null or { Type: JTokenType.Null } ? 0 : owner[key]!.Value<uint>();

    private static bool Bool(JObject owner, string key)
        => owner[key] is { Type: not JTokenType.Null } && owner[key]!.Value<bool>();

    private static List<string> StrList(JObject owner, string key)
        => owner[key] is JArray array
            ? [.. array.Where(item => item.Type == JTokenType.String).Select(item => item.Value<string>() ?? "")]
            : [];

    private sealed record Options(string QuestPath, string OutputPath, string Persona, bool Help);

    private static bool TryParseArguments(string[] args, out Options options, out string error) {
        options = new Options("", "", "", false);
        error = "";

        string? questPath = null;
        string? outputPath = null;
        var persona = "";

        for (var i = 0; i < args.Length; i++) {
            switch (args[i]) {
                case "-h" or "--help":
                    options = new Options("", "", "", true);
                    return true;

                case "--quest":
                    if (!TryTakeValue(args, ref i, args[i], out var questValue, out error)) {
                        return false;
                    }

                    questPath = questValue;
                    break;

                case "--output":
                    if (!TryTakeValue(args, ref i, args[i], out var outputValue, out error)) {
                        return false;
                    }

                    outputPath = outputValue;
                    break;

                case "--persona":
                    if (!TryTakeValue(args, ref i, args[i], out var personaValue, out error)) {
                        return false;
                    }

                    persona = personaValue;
                    break;

                default:
                    error = $"unknown argument: {args[i]}";
                    return false;
            }
        }

        if (questPath is null) {
            error = "missing required argument: --quest <path>";
            return false;
        }

        if (outputPath is null) {
            error = "missing required argument: --output <path>";
            return false;
        }

        options = new Options(questPath, outputPath, persona, false);
        return true;
    }

    private static bool TryTakeValue(
        string[] args, ref int index, string flag, out string value, out string error) {
        if (index + 1 >= args.Length) {
            value = "";
            error = $"missing value for {flag}";
            return false;
        }

        index++;
        value = args[index];
        error = "";
        return true;
    }

    private static string Describe(Exception exception) {
        var messages = new List<string>();

        for (var current = exception; current is not null; current = current.InnerException) {
            if (!string.IsNullOrWhiteSpace(current.Message) && !messages.Contains(current.Message)) {
                messages.Add(current.Message);
            }
        }

        return string.Join(" -> ", messages);
    }

    private sealed class FixtureException(string message) : Exception(message);
}