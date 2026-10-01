#!/usr/bin/env python3
"""p7-15 (task 7.14, item 5): a fresh attempt at the 7 still-unnamed WAD classes of p6-11.

The instrument is Imcodec's own `StringHash.Compute` (Imview/submodule/Imcodec/src/Imcodec.Cryptography/
StringHash.cs), applied to a C++ type name spelled the way the dumps spell it (`class QuestTemplate`).
A class hash is 31-bit by construction: the result is `abs(int32)`, so it can never exceed 2**31.

Run:  python3 docs/evidence/phase-7/p7-15-class-hash.py
Reads (read-only): the two Imcodec class dumps below. Writes nothing.
"""
import itertools
import json

DUMPS = {
    'client r756936 (ClientDump.json)': '/home/jason/Documents/git-projects/Imview/submodule/Imcodec/src/Imcodec.ObjectProperty/GeneratorInput/ClientDump.json',
    'server r806919': '/home/jason/Documents/git-projects/Imlight/submodule/Imcodec/src/Imcodec.ObjectProperty/GeneratorInput/r806919_Wizard_1_610.json',
}

# The 7 classes p6-11 left unnamed, with the site each was measured at (docs/evidence/quest-catalog-findings.md).
UNNAMED = {
    0x3CDBE781: 'trigger_groups.xml (3,377 zone WADs)',
    0x217D4C2E: 'Combat/CombatAIData.xml + CombatAIDataBruteForce.xml',
    0x45D3C534: 'Root.wad/HighScoreConfig.xml',
    0x56C56C0F: 'Root.wad/MonsterMagicWorldLoot.xml',
    0x0F775B20: 'Root.wad/WhirlyBurlyConfig.xml',
    0x32A408E1: 'Root.wad/NPCServices.xml',
    0xB2DE6601: 'Root.wad/TemplateManifest.xml',
}


def s32(x):
    x &= 0xFFFFFFFF
    return x - (1 << 32) if x & 0x80000000 else x


def compute(name):
    """Imcodec.Cryptography.StringHash.Compute, with C# int (32-bit, arithmetic-shift) semantics."""
    if not name:
        return 0
    result, shift1, shift2 = 0, 0, 32
    for ch in name:
        v = (ord(ch) & 0xFF) - 32
        result = s32(result ^ s32(v << (shift1 & 31)))
        if shift1 > 24:
            result = s32(result ^ (v >> (shift2 & 31)))
            if shift1 >= 27:
                shift1 -= 32
                shift2 += 32
        shift1 += 5
        shift2 -= 5
    if result < 0:
        result = -result
    return result & 0xFFFFFFFF


print('== 1. the instrument, validated on every class the two dumps name')
all_hashes = []
for label, path in DUMPS.items():
    classes = json.load(open(path))['classes'].values()
    ok = sum(1 for c in classes if compute(c['name']) == c['hash'])
    all_hashes += [c['hash'] for c in classes]
    print(f'   {label}: {ok} of {len(classes)} dump hashes reproduced from the class name')
print(f'   largest hash in either dump: {max(all_hashes)}  (2**31 = {2**31}; hashes >= 2**31: {sum(h >= 2**31 for h in all_hashes)})')

print('== 2. 0xb2de6601 is not a class hash')
print(f'   0xb2de6601 = {0xB2DE6601} > 2**31, so no StringHash.Compute result can equal it.')
print(f"   compute('class TemplateManifest') = {compute('class TemplateManifest')}  (Imcodec binds Root.wad/TemplateManifest.xml to 171021254)")

print('== 3. names for the other six, from the file each class was measured in')
CANDIDATE_STEMS = {
    0x3CDBE781: ['TriggerGroups', 'TriggerGroup', 'TriggerGroupList', 'ZoneTriggerGroups', 'WizZoneTriggerGroups', 'WizTriggerGroups'],
    0x217D4C2E: ['CombatAIData', 'CombatAIDataBruteForce', 'CombatAIDataList', 'CombatAIList', 'CombatAIConfig', 'WizCombatAIData', 'CombatAIDataTemplate', 'CombatAI'],
    0x45D3C534: ['HighScoreConfig', 'HighScore', 'HighScoreConfigData', 'HighScoreList'],
    0x56C56C0F: ['MonsterMagicWorldLoot', 'MonsterMagicWorldLootList', 'MonsterMagicWorldLootTable', 'MonsterMagicLoot', 'WorldLoot'],
    0x0F775B20: ['WhirlyBurlyConfig', 'WhirlyBurly', 'WhirlyBurlyConfigData'],
    0x32A408E1: ['NPCServices', 'NPCService', 'NPCServicesList', 'NPCServicesData'],
}
AFFIXES = ['', 'Template', 'Data', 'List', 'Config', 'Info', 'Manager', 'Table', 'Set', 'Map', 'Group', 'Groups']
for target, stems in CANDIDATE_STEMS.items():
    hits = sorted({f'class {p}{stem}{a}' for stem in stems for p in ('', 'Wiz', 'SG_', 'Client', 'Server') for a in AFFIXES
                   if compute(f'class {p}{stem}{a}') == target})
    print(f'   0x{target:08x} ({target}) [{UNNAMED[target]}] ->', hits if hits else 'no match')

print('== 4. CombatAIData: a wider token search (the C twin, p7-15-class-hash-search.c, ran the full grid)')
TOKENS = ['Combat', 'AI', 'Data', 'Brute', 'Force', 'List', 'Template', 'Config', 'Info', 'Wiz', 'Base', 'Manager', 'Table', 'Battle', 'Creature', 'Monster', 'Enemy', 'Behavior', 'Rules', 'Settings']
found = []
for n in range(1, 5):
    for combo in itertools.product(TOKENS, repeat=n):
        if compute('class ' + ''.join(combo)) == 0x217D4C2E:
            found.append('class ' + ''.join(combo))
print('   depth<=4 over', len(TOKENS), 'tokens ->', found if found else 'no match')
