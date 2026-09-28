# final-verify — the Phase-5 process clause (a CITATION, verified, not redone)

The brief and the AC say this half is already satisfied and asks only that **the merge be verified
real in the history** and **the branch be gone from the remote**. Both were checked, from two
independent directions: the local git history and GitHub's own API over the GitHub MCP.

`HEAD` during this check: `f7e7004` on `main`. Remote: `git@github.com:jasonl8446/spiraldb-ui.git`.

## 1. The merge is real in the history

```
$ git merge-base --is-ancestor 1bac35c6 HEAD && echo YES
YES: 1bac35c6 is an ancestor of HEAD

$ git show --no-patch --format='sha=%H%nparents=%P%nauthor=%an <%ae>%ndate=%aI%nsubject=%s' 1bac35c6
sha=1bac35c6443045327a5fc06fb56f71a172c57a19
parents=9b5e685270b3018e8ac914d77f1359a50527820a fbc8e134e16bd0c76ac1cec50a3c73bcdd5cf560
author=Jason Liszka <31484975+jasonl8446@users.noreply.github.com>
date=2026-09-27T22:30:45-04:00
subject=Merge PR #7: Phase 5 — Dashboard & Polish (D29 gate-5 self-merge at ci green)
```

`git log --oneline --decorate --all` shows `1bac35c (origin/main, origin/HEAD)` — the merge commit
**is** the remote `main` tip.

## 2. The branch is gone from the remote

```
$ git branch -r
  origin/HEAD -> origin/main
  origin/main
```

The **local** branch `phase-5-dashboard-polish` still exists (expected — the delete is a remote
operation), but no remote-tracking ref for it does.

## 3. GitHub's own answer (authoritative, via the GitHub MCP)

`pull_request_read(owner=jasonl8446, repo=spiraldb-ui, pullNumber=7, method=get)`:

| field | value |
|---|---|
| `state` | `closed` |
| `merged` | `true` |
| `merged_by` | `jasonl8446` |
| `merged_at` | `2026-09-28T02:30:45Z` |
| `head.ref` | `phase-5-dashboard-polish` |
| `head.sha` | `fbc8e134e16bd0c76ac1cec50a3c73bcdd5cf560` |
| `base.ref` | `main` |
| `base.sha` | `9b5e685270b3018e8ac914d77f1359a50527820a` |
| `html_url` | https://github.com/jasonl8446/spiraldb-ui/pull/7 |

**The parents of the local merge commit are exactly this PR's `base.sha` and `head.sha`** —
`9b5e6852…` and `fbc8e134…`. So the commit in local history is this PR's merge, not a lookalike.

`list_branches(owner=jasonl8446, repo=spiraldb-ui)`:

```json
[{"name":"main","sha":"1bac35c6443045327a5fc06fb56f71a172c57a19","protected":true}]
```

The remote holds **exactly one branch, `main`, and its sha is the merge commit `1bac35c6`**.
`phase-5-dashboard-polish` is absent.

## 4. CI green, first run, 5m14s

`pull_request_read(…, method=get_check_runs)`:

```json
{"total_count":1,"check_runs":[{"id":108762915403,"name":"ci","status":"completed",
 "conclusion":"success",
 "html_url":"https://github.com/jasonl8446/spiraldb-ui/actions/runs/36369599921/job/108762915403",
 "started_at":"2026-09-28T02:23:01Z","completed_at":"2026-09-28T02:28:15Z"}]}
```

- exactly **one** check run, named `ci`, `conclusion: success` → **first run, no re-run**;
- run id **36369599921** — the id the brief cites;
- `02:28:15Z − 02:23:01Z` = **5 min 14 s** — the `5m14s` the brief cites.

## 5. The merge is logged

`.omd/prd/progress.txt` line 912 (ROUND 90):

> **[2026-09-27] ROUND 90 — GATE-5 PASSED: PHASE 5 IS MERGED.** PR #7 (19 commits) merged to main
> as **1bac35c6**, branch `phase-5-dashboard-polish` deleted, **CI green in 5m14s on the FIRST run** …

and line 988 records the clause is a citation rather than work.

## Verdict

**PASS.** Every element the clause names is independently confirmed: opened, CI green first run in
5m14s (run 36369599921), merged as `1bac35c6` (parents match the PR's base and head), branch
deleted from the remote (remote holds only `main`), merge logged at round 90.

**One honest limit**: the GitHub API can prove the PR *was opened and merged through the MCP
account*, but it cannot prove *which client* opened it. "Opened through the GitHub MCP" rests on
the round-90 log, and is reported here as a **re-read** claim, not an independently re-run one.
The merge, the branch deletion, the CI run and the duration are all independently verified.