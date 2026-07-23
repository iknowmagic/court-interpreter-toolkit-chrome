#!/usr/bin/env python3
"""Combine exact and structural duplicate detectors into one advisory report."""

import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


ANSI_RE = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")
CLONE_HEADER_RE = re.compile(r"^Clone found(?:\s+\([^)]+\))?:\s*$")
JSCPD_HEADER_RE = re.compile(r"^Clone found(?:\s+\([^)]+\))?\s*$")
DETECTOR_TABLE_PREFIXES = ("\u250c", "\u251c", "\u2514", "\u2502")
DETECTOR_SUMMARY_PREFIXES = ("Found ", "time:")


@dataclass(frozen=True)
class CommandResult:
    label: str
    command: tuple[str, ...]
    returncode: int
    output: str


def strip_ansi(value: str) -> str:
    """Remove terminal color/control sequences from detector output."""
    return ANSI_RE.sub("", value)


def combined_output(stdout: str, stderr: str) -> str:
    """Join stdout and stderr without merging their boundary lines."""
    parts = [part for part in (stdout, stderr) if part]
    return "\n".join(part.rstrip("\n") for part in parts)


def run_command(repo_root: Path, label: str, command: tuple[str, ...]) -> CommandResult:
    """Run a detector command from the repository root."""
    try:
        completed = subprocess.run(
            command,
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError as error:
        return CommandResult(
            label=label,
            command=command,
            returncode=127,
            output=str(error),
        )

    return CommandResult(
        label=label,
        command=command,
        returncode=completed.returncode,
        output=strip_ansi(combined_output(completed.stdout, completed.stderr)),
    )


def collect_blocks(output: str, is_header: Callable[[str], bool]) -> list[str]:
    """Collect nonblank blocks starting with a detector finding header."""
    blocks: list[str] = []
    current: list[str] = []

    for line in output.splitlines():
        if is_header(line):
            if current:
                blocks.append("\n".join(current).rstrip())
            current = [line]
            continue

        if not current:
            continue

        if not line.strip():
            blocks.append("\n".join(current).rstrip())
            current = []
            continue

        if line.startswith(DETECTOR_SUMMARY_PREFIXES) or line.startswith(
            DETECTOR_TABLE_PREFIXES
        ):
            blocks.append("\n".join(current).rstrip())
            current = []
            continue

        current.append(line)

    if current:
        blocks.append("\n".join(current).rstrip())

    return blocks


def parse_clone_blocks(output: str) -> list[str]:
    """Parse jscpd clone finding blocks."""
    return collect_blocks(
        output,
        lambda line: bool(CLONE_HEADER_RE.match(line) or JSCPD_HEADER_RE.match(line)),
    )


def parse_similarity_blocks(output: str) -> list[str]:
    """Parse similarity-ts finding blocks."""
    return collect_blocks(output, lambda line: line.startswith("Similarity:"))


def command_unavailable(result: CommandResult) -> bool:
    """Detect common command-not-found output forms."""
    unavailable_markers = (
        "command not found",
        "not found",
        "No such file or directory",
        "could not execute",
        "spawn",
        "ENOENT",
    )
    lowered = result.output.lower()
    return any(marker.lower() in lowered for marker in unavailable_markers)


def print_failure(result: CommandResult) -> None:
    """Print a detector failure with full command output."""
    print(f"{result.label} detector failed.", file=sys.stderr)
    print(f"Command: {' '.join(result.command)}", file=sys.stderr)
    print(f"Exit code: {result.returncode}", file=sys.stderr)
    print("Captured output:", file=sys.stderr)
    print("```", file=sys.stderr)
    print(result.output, file=sys.stderr)
    print("```", file=sys.stderr)

    if result.label == "similarity-ts" and command_unavailable(result):
        cargo_path = Path.home() / ".cargo" / "bin" / "similarity-ts"
        cargo_bin = cargo_path.parent
        print(
            "similarity-ts is required for structural similarity detection.",
            file=sys.stderr,
        )
        print(
            f"Install it so the executable exists at {cargo_path},",
            file=sys.stderr,
        )
        print(f"and ensure {cargo_bin} is on PATH.", file=sys.stderr)


def print_report(clone_blocks: list[str], similarity_blocks: list[str]) -> None:
    """Print advisory report sections for detector findings."""
    if not clone_blocks and not similarity_blocks:
        print("No duplicate candidates found.")
        return

    print("Potential duplication detected.")
    print(
        "Review each pair before refactoring. Detector output is evidence, not an instruction to abstract."
    )

    if clone_blocks:
        print()
        print("Exact duplicates")
        print()
        print("\n\n".join(clone_blocks))

    if similarity_blocks:
        print()
        print("Structural similarity")
        print()
        print("\n\n".join(similarity_blocks))


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    jscpd_result = run_command(repo_root, "jscpd", ("pnpm", "detect-duplicates"))
    similarity_result = run_command(repo_root, "similarity-ts", ("pnpm", "similarity"))

    clone_blocks = parse_clone_blocks(jscpd_result.output)
    similarity_blocks = parse_similarity_blocks(similarity_result.output)
    failures: list[CommandResult] = []

    if jscpd_result.returncode != 0 and not clone_blocks:
        failures.append(jscpd_result)
    if similarity_result.returncode != 0 and not similarity_blocks:
        failures.append(similarity_result)

    print_report(clone_blocks, similarity_blocks)

    for result in failures:
        print_failure(result)

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
