#!/usr/bin/env python3
"""Block approve, merge and deploy commands inside the /issue-to-pr loop's agents.

Runs as a user-level Kimi Code PreToolUse hook. It stays inert unless the
current checkout contains artifacts/issue-to-pr/active.json, which the runner
creates only during a run. It reads the hook's JSON on stdin and exits 2 to
block the command. The runner enables agent-branch pushes only during Handoff.

The arguments of git, gh and plain file tools such as grep are data, so words in
a commit message or a search don't count. In anything else, any word that names
git, gh, npm, cdk, aws or a deploy script starts a guarded command, which covers
launchers such as env, timeout and xargs without listing them. Inline scripts,
and text fed to a shell or interpreter, are read as code.

This is not a security boundary. A command written another way can get past it.
Branch protection on GitHub is the real control.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import sys
from itertools import dropwhile

# ---------------------------------------------------------------------------
# Repository settings. Add whatever deploys or releases in this repository.
# ---------------------------------------------------------------------------

# Scripts that deploy, matched against each word of a command.
DEPLOY_SCRIPT = re.compile(r"(?:^|/)scripts/deploy/|(?:^|/)deploy[\w.-]*\.sh$")

# Programs that deploy, and the subcommands that count. An empty set blocks the
# program outright. `aws`, `cdk` and `npm run deploy` have their own rules below.
DEPLOY_TOOLS: dict[str, set[str]] = {
    "make": {"deploy", "release", "publish", "destroy"},
    "terraform": {"apply", "destroy", "import"},
    "tofu": {"apply", "destroy", "import"},
    "pulumi": {"up", "destroy"},
    "kubectl": {"apply", "create", "delete", "patch", "replace", "rollout", "scale"},
    "helm": {"install", "upgrade", "uninstall", "rollback"},
    "docker": {"push"},
    "serverless": {"deploy", "remove"},
    "sls": {"deploy", "remove"},
    "netlify": {"deploy"},
    "fly": {"deploy"},
    "flyctl": {"deploy"},
    "vercel": set(),
    "heroku": set(),
    "gcloud": set(),
    "az": set(),
}

# ---------------------------------------------------------------------------
# End of settings.
# ---------------------------------------------------------------------------

# The workflow looks for this text to prove the guard fired.
MARKER = "LOOP_GUARD"
ALLOW_PUSH_FLAG = "--allow-agent-branch-push"
UNPARSED = "a command it could not parse"

OPERATOR_CHARS = frozenset(";&|()<>\n")
SHELLS = {"sh", "bash", "zsh", "dash", "ksh", "fish"}
# Tools that only read or handle files, and never run their arguments.
PLAIN_TOOLS = {
    "echo", "printf", "cat", "grep", "egrep", "fgrep", "rg", "head", "tail", "less", "wc", "sort",
    "uniq", "cut", "sed", "awk", "diff", "ls", "which", "type", "test", "[", "man", "pgrep", "pkill",
    "chmod", "chown", "cp", "mv", "rm", "ln", "mkdir", "touch", "stat", "file", "tree", "nl", "xxd",
    "du", "basename", "dirname", "realpath", "shellcheck",
}
FIND_ACTIONS = {"-exec", "-execdir", "-ok", "-okdir"}
GIT_OPTIONS_WITH_VALUE = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"}
GH_OPTIONS_WITH_VALUE = {"-R", "--repo"}
NPM_OPTIONS_WITH_VALUE = {"--prefix", "-C", "--workspace", "-w"}
NPM_PROGRAMS = {"npm", "npx"}
CDK_PROGRAMS = {"cdk", "aws-cdk"}
CDK_ACTIONS = {"deploy", "destroy", "watch", "bootstrap"}

HEREDOC = re.compile(
    r"(?P<start><<-?[ \t]*(?P<quote>['\"\\]?)(?P<tag>[\w.-]+)['\"]?[^\n]*\n)(?P<body>.*?)^[ \t]*(?P=tag)[ \t]*$",
    re.DOTALL | re.MULTILINE,
)
ASSIGNMENT = re.compile(r"[A-Za-z_]\w*=")
INTERPRETER = re.compile(r"(?:python|node|ruby|perl)[\d.]*")
RUNNER_WORD = r"(?:^|[\s/(])(?:sh|bash|zsh|dash|ksh|fish|python[\d.]*|node|ruby|perl)(?=\s|$)"
CODE_RUNNER = re.compile(RUNNER_WORD)
PIPED_RUNNER = re.compile(rf"\|&?[^|;&\n]*?{RUNNER_WORD}")
FED_INPUT = re.compile(r"<<<|<\(")
SHELL_SCRIPT_FLAG = re.compile(r"-[A-Za-z]*c")
INLINE_CODE_FLAG = re.compile(r"-[A-Za-z]*[cep]|--eval|--print")
SHORT_NO_VERIFY = re.compile(r"-[A-Za-z]*n[A-Za-z]*")
AGENT_BRANCH = re.compile(r"agent/issue-[1-9][0-9]*")
CODE_PUNCTUATION = re.compile(r"[\"'`,\[\](){}]")

GH_API_RULES = tuple(
    (re.compile(pattern), reason)
    for pattern, reason in (
        (r"/merges?\b|mergePullRequest|enablePullRequestAutoMerge", "merging through the GitHub API"),
        (r"/reviews\b|PullRequestReview", "reviewing through the GitHub API"),
        (r"refs/heads/(?:main|master)\b", "changing the default branch through the GitHub API"),
        (r"/dispatches\b|/rerun\b", "starting a workflow through the GitHub API"),
        (r"/labels\b|labels\[\]=|addLabelsToLabelable|plan-approved", "changing labels through the GitHub API"),
        (r"/comments\b|addComment\b", "commenting through the GitHub API"),
    )
)
# For code the shell can't split into commands: inline scripts and text fed to a shell.
CODE_RULES = tuple(
    (re.compile(pattern), reason)
    for pattern, reason in (
        (r"\bgit\s+(?:-\S+\s+)*push\b", "pushing from inline code"),
        (r"\bgh\s+(?:-\S+\s+)*pr\s+(?:-\S+\s+)*(?:merge|review)\b", "merging or reviewing from inline code"),
        (r"\bgh\s+workflow\s+run\b", "starting a workflow from inline code"),
        (r"\bcdk\b.*\b(?:deploy|destroy)\b", "deploying from inline code"),
        (r"\bnpm\b.*\brun\S*\s+(?:deploy|destroy)\b", "deploying from inline code"),
        (r"\baws\s+[a-z0-9-]+\s+[a-z]", "using the AWS CLI from inline code"),
        (r"scripts/deploy/", "running a deploy script from inline code"),
    )
) + tuple(
    (
        re.compile(rf"\b{re.escape(tool)}\s+" + (rf".*\b(?:{'|'.join(sorted(actions))})\b" if actions else "[a-z]")),
        f"deploying with {tool} from inline code",
    )
    for tool, actions in DEPLOY_TOOLS.items()
)


def split_substitutions(text: str) -> tuple[str, list[str]]:
    """Pull out $(...) and backtick commands and drop comments, leaving quoted text alone."""
    output: list[str] = []
    nested: list[str] = []
    index = 0
    in_double = False
    while index < len(text):
        char = text[index]
        if char == "\\":
            output.append(text[index : index + 2])
            index += 2
        elif char == "'" and not in_double:
            end = text.find("'", index + 1)
            end = len(text) - 1 if end < 0 else end
            output.append(text[index : end + 1])
            index = end + 1
        elif char == "#" and not in_double and (index == 0 or text[index - 1].isspace()):
            end = text.find("\n", index)
            index = len(text) if end < 0 else end
        elif text.startswith("$(", index):
            depth, end = 1, index + 2
            while end < len(text) and depth:
                depth += {"(": 1, ")": -1}.get(text[end], 0)
                end += 1
            nested.append(text[index + 2 : end - 1])
            output.append("$SUBSTITUTION")
            index = end
        elif char == "`":
            end = index + 1
            while end < len(text) and text[end] != "`":
                end += 2 if text[end] == "\\" else 1
            nested.append(text[index + 1 : end])
            output.append("$SUBSTITUTION")
            index = end + 1
        else:
            in_double = not in_double if char == '"' else in_double
            output.append(char)
            index += 1
    return "".join(output), nested


def simple_commands(text: str) -> list[list[str]]:
    """Split shell text into simple commands, each a list of unquoted words."""
    lexer = shlex.shlex(text, posix=True, punctuation_chars="".join(OPERATOR_CHARS))
    lexer.whitespace = " \t\r"
    lexer.whitespace_split = True
    lexer.commenters = ""
    commands: list[list[str]] = [[]]
    skip_target = False
    for token in lexer:
        is_operator = bool(token) and set(token) <= OPERATOR_CHARS
        if skip_target and not is_operator:
            skip_target = False
        elif is_operator:
            redirect = bool(set(token) & {"<", ">"})
            separator = bool(set(token) & {";", "|", "\n", "(", ")"}) or "&&" in token or token == "&"
            if redirect and commands[-1] and commands[-1][-1].isdigit():
                commands[-1].pop()
            skip_target = redirect and not separator
            if separator:
                commands.append([])
        else:
            commands[-1].append(token)
    return [words for words in commands if words]


def program_name(word: str) -> str:
    """The program a word names, without its path or an npm-style @version."""
    return os.path.basename(word).split("@", 1)[0]


def without_assignments(words: list[str]) -> list[str]:
    return list(dropwhile(ASSIGNMENT.match, words))


def positional(args: list[str], options_with_value: set[str]) -> list[str]:
    """The words left after dropping flags, including the values of the named ones."""
    words: list[str] = []
    index = 0
    while index < len(args):
        if args[index] in options_with_value:
            index += 2
            continue
        if not args[index].startswith("-"):
            words.append(args[index])
        index += 1
    return words


def flag_value(args: list[str], flag: re.Pattern[str]) -> str | None:
    """The word after the first matching flag, such as the script after -c."""
    for position, arg in enumerate(args[:-1]):
        if flag.fullmatch(arg):
            return args[position + 1]
    return None


def code_reason(code: str) -> str | None:
    text = CODE_PUNCTUATION.sub(" ", code)
    for pattern, reason in CODE_RULES:
        if pattern.search(text):
            return reason
    return None


def calls_gh_api(words: list[str]) -> bool:
    words = without_assignments(words)
    if not words or program_name(words[0]) in PLAIN_TOOLS:
        return False
    for index, word in enumerate(words):
        if program_name(word) == "gh":
            return positional(words[index + 1 :], GH_OPTIONS_WITH_VALUE)[:1] == ["api"]
    return False


def is_agent_branch_push(args: list[str]) -> bool:
    if args[:1] in (["-u"], ["--set-upstream"]):
        args = args[1:]
    return len(args) == 2 and args[0] == "origin" and AGENT_BRANCH.fullmatch(args[1]) is not None


def git_reason(args: list[str], allow_push: bool) -> str | None:
    index = 0
    while index < len(args) and args[index].startswith("-"):
        index += 2 if args[index] in GIT_OPTIONS_WITH_VALUE else 1
    subcommand, rest = (args[index], args[index + 1 :]) if index < len(args) else ("", [])
    if "--no-verify" in args or (subcommand == "commit" and any(SHORT_NO_VERIFY.fullmatch(arg) for arg in rest)):
        return "skipping a git hook"
    if subcommand == "push" and not (allow_push and index == 0 and is_agent_branch_push(rest)):
        return "pushing anywhere except an agent/issue-<N> branch"
    return None


def gh_reason(args: list[str]) -> str | None:
    group, action = (positional(args, GH_OPTIONS_WITH_VALUE) + ["", ""])[:2]
    if group == "pr" and action == "merge":
        return "merging a pull request"
    if group == "pr" and action == "review":
        return "reviewing a pull request"
    if group == "workflow" and action in {"run", "enable", "disable"}:
        return "starting or changing a workflow"
    if group == "run" and action == "rerun":
        return "rerunning a workflow"
    if group == "issue" and action == "edit":
        return "editing an issue, which could add a plan-approved label"
    if group == "issue" and action in {"comment", "create"}:
        return "writing to issues, which are a person's spec"
    if group == "label" and action != "list":
        return "changing labels"
    return None


def npm_reason(args: list[str]) -> str | None:
    words = positional(args, NPM_OPTIONS_WITH_VALUE)
    if words[:1] in (["run"], ["run-script"]) and words[1:2] in (["deploy"], ["destroy"]):
        return "deploying with an npm script"
    if {program_name(arg) for arg in args} & CDK_PROGRAMS and CDK_ACTIONS & set(args):
        return "deploying with CDK"
    return None


def command_reason(words: list[str], allow_push: bool) -> str | None:
    hooks_skipped = any(word.startswith("SKIP=") for word in words)
    words = without_assignments(words)
    if not words or program_name(words[0]) in PLAIN_TOOLS:
        return None
    if program_name(words[0]) == "find":
        actions = [index for index, word in enumerate(words) if word in FIND_ACTIONS]
        if not actions:
            return None
        words = words[actions[0] + 1 :]

    # The first guarded program owns the words after it, so a message stays data.
    for index, word in enumerate(words):
        program, args = program_name(word), words[index + 1 :]
        if DEPLOY_SCRIPT.search(word):
            return "running a deploy script"
        if program in SHELLS:
            script = flag_value(args, SHELL_SCRIPT_FLAG)
            if script is not None:
                return blocked_reason(script, allow_push)
        if INTERPRETER.fullmatch(program):
            code = flag_value(args, INLINE_CODE_FLAG)
            if code is not None:
                return code_reason(code)
            if "-m" in args:
                return None
        if program == "eval":
            return blocked_reason(" ".join(args), allow_push)
        if program == "git":
            return "skipping a git hook" if hooks_skipped else git_reason(args, allow_push)
        if program == "gh":
            return gh_reason(args)
        if program in NPM_PROGRAMS:
            return npm_reason(args)
        if program in CDK_PROGRAMS:
            return "deploying with CDK" if CDK_ACTIONS & set(args) else None
        if program == "aws" and (index == 0 or len(args) >= 2):
            return "using the AWS CLI"
        if program in DEPLOY_TOOLS:
            actions = DEPLOY_TOOLS[program]
            if actions:
                return f"deploying with {program}" if actions & set(args) else None
            if index == 0 or len(args) >= 2:
                return f"deploying with {program}"
    return None


def blocked_reason(command: str, allow_agent_branch_push: bool = False) -> str | None:
    """Return why the command is blocked, or None when it may run."""
    source = command.replace("\\\n", " ")
    expanded_bodies: list[str] = []
    code: list[str] = []

    def drop_body(match: re.Match[str]) -> str:
        line_start = source.rfind("\n", 0, match.start()) + 1
        if CODE_RUNNER.search(source[line_start : match.end("start")]):
            code.append(match["body"])
        if not match["quote"]:
            expanded_bodies.append(match["body"])
        return match["start"]

    text = HEREDOC.sub(drop_body, source)
    text, nested = split_substitutions(text)
    for body in expanded_bodies:
        nested += split_substitutions(body)[1]
    for inner in nested:
        reason = blocked_reason(inner, allow_agent_branch_push)
        if reason:
            return reason

    try:
        commands = simple_commands(text)
    except ValueError:
        return UNPARSED
    for words in commands:
        reason = command_reason(words, allow_agent_branch_push)
        if reason:
            return reason

    code += [line for line in text.splitlines() if FED_INPUT.search(line) and CODE_RUNNER.search(line)]
    if PIPED_RUNNER.search(text):
        code.append(text)
    for snippet in code:
        reason = code_reason(snippet)
        if reason:
            return reason
    if any(calls_gh_api(words) for words in commands):
        for pattern, reason in GH_API_RULES:
            if pattern.search(command):
                return reason
    return None


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        command = payload["tool_input"]["command"]
        if not isinstance(command, str):
            raise TypeError("command is not a string")
    except (ValueError, KeyError, TypeError) as error:
        print(f"{MARKER}: could not read the command, so it was blocked ({error}).", file=sys.stderr)
        return 2

    allow_push = ALLOW_PUSH_FLAG in sys.argv[1:]
    active_path = os.path.join(
        payload.get("cwd") or os.getcwd(), "artifacts", "issue-to-pr", "active.json"
    )
    if not allow_push and not os.path.exists(active_path):
        return 0
    if not allow_push:
        try:
            with open(active_path, encoding="utf-8") as active_file:
                active = json.load(active_file)
            if active.get("active") is not True or not isinstance(
                active.get("allow_agent_branch_push"), bool
            ):
                raise ValueError("invalid active run state")
            allow_push = active["allow_agent_branch_push"]
        except (OSError, ValueError, TypeError, AttributeError) as error:
            print(f"{MARKER}: could not read the active run state, so it was blocked ({error}).", file=sys.stderr)
            return 2

    reason = blocked_reason(command, allow_push)
    if reason is None:
        return 0
    if reason == UNPARSED:
        print(f"{MARKER}: blocked {reason}. Rewrite it in plain shell.", file=sys.stderr)
        return 2
    print(
        f"{MARKER}: blocked {reason}. People approve, merge and deploy; the "
        "/issue-to-pr loop stops at the pull request. Do not retry this or work around it.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
