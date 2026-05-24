import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type FileState =
	| "staged"
	| "modified"
	| "untracked"
	| "deleted"
	| "renamed"
	| "conflict";

type FileSummary = {
	path: string;
	state: FileState;
	staged: boolean;
	unstaged: boolean;
	additions: number;
	deletions: number;
	binary: boolean;
};

type DiffSnapshot =
	| {
			kind: "loading";
			updatedAt: number;
	  }
	| {
			kind: "not-git";
			updatedAt: number;
			message: string;
	  }
	| {
			kind: "error";
			updatedAt: number;
			message: string;
	  }
	| {
			kind: "repo";
			updatedAt: number;
			root: string;
			repoName: string;
			branch: string;
			totalFiles: number;
			stagedFiles: number;
			unstagedFiles: number;
			untrackedFiles: number;
			conflictFiles: number;
			additions: number;
			deletions: number;
			binaryFiles: number;
			files: FileSummary[];
	  };

type NumStat = {
	additions: number;
	deletions: number;
	binary: boolean;
};

const STATUS_KEY = "forjd.git-diff-status";
const REFRESH_DELAY_MS = 150;
const POLL_INTERVAL_MS = 5000;
const MUTATING_TOOLS = new Set(["bash", "edit", "write"]);

function unrefTimer(timer: unknown) {
	const maybeTimer = timer as { unref?: () => void } | undefined;
	maybeTimer?.unref?.();
}

export default function forjdPiExtensionPack(pi: ExtensionAPI) {
	let enabled = true;
	let sidebar: GitDiffSidebar | undefined;
	let overlayHandle: OverlayHandle | undefined;
	let closeSidebar: (() => void) | undefined;
	let lastSnapshot: DiffSnapshot = { kind: "loading", updatedAt: Date.now() };
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;
	let pollTimer: ReturnType<typeof setInterval> | undefined;
	let refreshRunning = false;
	let refreshAgain = false;

	function mountSidebar(ctx: ExtensionContext) {
		if (!enabled || !ctx.hasUI || overlayHandle || sidebar) return;

		void ctx.ui
			.custom<void>(
				(tui, theme, _keybindings, done) => {
					closeSidebar = () => {
						overlayHandle?.focus();
						done();
					};
					sidebar = new GitDiffSidebar(theme, tui, lastSnapshot);
					return sidebar;
				},
				{
					overlay: true,
					overlayOptions: {
						anchor: "top-right",
						width: "28%",
						minWidth: 34,
						maxHeight: "82%",
						margin: { top: 1, right: 1 },
						visible: (termWidth) => termWidth >= 100,
						nonCapturing: true,
					},
					onHandle: (handle) => {
						overlayHandle = handle;
					},
				},
			)
			.catch(() => {
				// The sidebar is best-effort UI. Any rendering failure should not affect pi.
			});
	}

	function unmountSidebar(ctx?: ExtensionContext) {
		if (refreshTimer) {
			clearTimeout(refreshTimer);
			refreshTimer = undefined;
		}
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = undefined;
		}
		if (closeSidebar) {
			closeSidebar();
		} else {
			overlayHandle?.hide();
			sidebar?.dispose?.();
		}
		closeSidebar = undefined;
		overlayHandle = undefined;
		sidebar = undefined;
		ctx?.ui.setStatus(STATUS_KEY, undefined);
	}

	function scheduleRefresh(ctx: ExtensionContext, delay = REFRESH_DELAY_MS) {
		if (!enabled) return;
		mountSidebar(ctx);
		if (refreshTimer) clearTimeout(refreshTimer);
		refreshTimer = setTimeout(() => {
			refreshTimer = undefined;
			void refresh(ctx);
		}, delay);
		unrefTimer(refreshTimer);
	}

	function startPolling(ctx: ExtensionContext) {
		if (pollTimer) clearInterval(pollTimer);
		pollTimer = setInterval(() => scheduleRefresh(ctx, 0), POLL_INTERVAL_MS);
		unrefTimer(pollTimer);
	}

	async function refresh(ctx: ExtensionContext) {
		if (!enabled) return;
		if (refreshRunning) {
			refreshAgain = true;
			return;
		}

		refreshRunning = true;
		try {
			const snapshot = await collectDiffSnapshot(pi, ctx.cwd, ctx.signal);
			lastSnapshot = snapshot;
			sidebar?.setSnapshot(snapshot);
			if (ctx.hasUI)
				ctx.ui.setStatus(STATUS_KEY, formatStatus(snapshot, ctx.ui.theme));
		} finally {
			refreshRunning = false;
			if (refreshAgain) {
				refreshAgain = false;
				scheduleRefresh(ctx, 0);
			}
		}
	}

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		mountSidebar(ctx);
		scheduleRefresh(ctx, 0);
		startPolling(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		unmountSidebar(ctx);
	});

	pi.on("tool_execution_end", (event, ctx) => {
		if (MUTATING_TOOLS.has(event.toolName)) scheduleRefresh(ctx);
	});

	pi.on("turn_end", (_event, ctx) => {
		scheduleRefresh(ctx);
	});

	pi.on("user_bash", (_event, ctx) => {
		// User shell commands may mutate the repository. Delay slightly so short commands can finish.
		scheduleRefresh(ctx, 700);
	});

	pi.registerCommand("git-diff-sidebar", {
		description:
			"Toggle or refresh the high-level git diff sidebar (on|off|refresh)",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();

			if (action === "off") {
				enabled = false;
				unmountSidebar(ctx);
				ctx.ui.notify("Git diff sidebar disabled", "info");
				return;
			}

			if (action === "on") {
				enabled = true;
				mountSidebar(ctx);
				startPolling(ctx);
				await refresh(ctx);
				ctx.ui.notify("Git diff sidebar enabled", "info");
				return;
			}

			if (action === "refresh") {
				enabled = true;
				mountSidebar(ctx);
				startPolling(ctx);
				await refresh(ctx);
				ctx.ui.notify("Git diff sidebar refreshed", "info");
				return;
			}

			enabled = !enabled;
			if (enabled) {
				mountSidebar(ctx);
				startPolling(ctx);
				await refresh(ctx);
				ctx.ui.notify("Git diff sidebar enabled", "info");
			} else {
				unmountSidebar(ctx);
				ctx.ui.notify("Git diff sidebar disabled", "info");
			}
		},
	});
}

class GitDiffSidebar implements Component {
	private snapshot: DiffSnapshot;
	private readonly theme: Theme;
	private readonly tui: TUI;
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;

	constructor(theme: Theme, tui: TUI, snapshot: DiffSnapshot) {
		this.theme = theme;
		this.tui = tui;
		this.snapshot = snapshot;
	}

	setSnapshot(snapshot: DiffSnapshot) {
		this.snapshot = snapshot;
		this.invalidate();
		this.tui.requestRender();
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		const safeWidth = Math.max(24, width);
		const innerWidth = Math.max(1, safeWidth - 2);
		const lines: string[] = [];
		const border = (text: string) => this.theme.fg("border", text);
		const row = (content = "") => {
			const clipped = truncateToWidth(content, innerWidth, "");
			const padding = " ".repeat(
				Math.max(0, innerWidth - visibleWidth(clipped)),
			);
			return `${border("│")}${clipped}${padding}${border("│")}`;
		};
		const separator = () => {
			lines.push(row(this.theme.fg("borderMuted", "─".repeat(innerWidth))));
		};

		lines.push(border(`╭${"─".repeat(innerWidth)}╮`));
		lines.push(row(` ${this.theme.fg("accent", this.theme.bold("Git diff"))}`));

		if (this.snapshot.kind === "loading") {
			separator();
			lines.push(row(` ${this.theme.fg("dim", "Loading repository state…")}`));
			lines.push(border(`╰${"─".repeat(innerWidth)}╯`));
			return this.cache(width, lines);
		}

		if (this.snapshot.kind === "not-git" || this.snapshot.kind === "error") {
			separator();
			const color = this.snapshot.kind === "error" ? "error" : "dim";
			for (const part of wrapWords(this.snapshot.message, innerWidth - 2)) {
				lines.push(row(` ${this.theme.fg(color, part)}`));
			}
			lines.push(
				row(` ${this.theme.fg("dim", relativeTime(this.snapshot.updatedAt))}`),
			);
			lines.push(border(`╰${"─".repeat(innerWidth)}╯`));
			return this.cache(width, lines);
		}

		const snapshot = this.snapshot;
		separator();
		lines.push(
			row(
				` ${this.theme.fg("muted", snapshot.repoName)} ${this.theme.fg("dim", "on")} ${this.theme.fg("accent", snapshot.branch)}`,
			),
		);
		lines.push(row(` ${summaryLine(snapshot, this.theme)}`));
		lines.push(
			row(
				` ${this.theme.fg("success", `+${snapshot.additions}`)} ${this.theme.fg("error", `-${snapshot.deletions}`)} ${this.theme.fg("dim", `${snapshot.totalFiles} files • ${relativeTime(snapshot.updatedAt)}`)}`,
			),
		);

		if (snapshot.totalFiles === 0) {
			separator();
			lines.push(row(` ${this.theme.fg("success", "Working tree clean")}`));
			lines.push(border(`╰${"─".repeat(innerWidth)}╯`));
			return this.cache(width, lines);
		}

		separator();
		const shown = snapshot.files.slice(0, 12);
		for (const file of shown) {
			lines.push(row(renderFileRow(file, innerWidth - 1, this.theme)));
		}
		const remaining = snapshot.files.length - shown.length;
		if (remaining > 0)
			lines.push(row(` ${this.theme.fg("dim", `… ${remaining} more`)}`));

		lines.push(separatorLine(innerWidth, this.theme));
		lines.push(
			row(` ${this.theme.fg("dim", "/git-diff-sidebar off|refresh")}`),
		);
		lines.push(border(`╰${"─".repeat(innerWidth)}╯`));

		return this.cache(width, lines);
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	dispose(): void {
		this.invalidate();
	}

	private cache(width: number, lines: string[]) {
		this.cachedWidth = width;
		this.cachedLines = lines.map((line) => truncateToWidth(line, width, ""));
		return this.cachedLines;
	}
}

async function collectDiffSnapshot(
	pi: ExtensionAPI,
	cwd: string,
	signal?: AbortSignal,
): Promise<DiffSnapshot> {
	const updatedAt = Date.now();
	try {
		const rootResult = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
			cwd,
			timeout: 1500,
			signal,
		});
		if (rootResult.code !== 0) {
			return {
				kind: "not-git",
				updatedAt,
				message: "Not inside a git repository",
			};
		}

		const root = rootResult.stdout.trim();
		const [statusResult, worktreeNumstatResult, stagedNumstatResult] =
			await Promise.all([
				pi.exec("git", ["status", "--porcelain=v1", "-uall", "-b"], {
					cwd: root,
					timeout: 2000,
					signal,
				}),
				pi.exec("git", ["diff", "--numstat"], {
					cwd: root,
					timeout: 2000,
					signal,
				}),
				pi.exec("git", ["diff", "--cached", "--numstat"], {
					cwd: root,
					timeout: 2000,
					signal,
				}),
			]);

		if (statusResult.code !== 0) {
			return {
				kind: "error",
				updatedAt,
				message: firstLine(
					statusResult.stderr ||
						statusResult.stdout ||
						"Unable to read git status",
				),
			};
		}

		const statusLines = statusResult.stdout.split("\n").filter(Boolean);
		const branchLine = statusLines.find((line) => line.startsWith("## "));
		const branch = parseBranchLine(branchLine);
		const changedLines = statusLines.filter((line) => !line.startsWith("## "));
		const stats = mergeNumstats(
			parseNumstat(worktreeNumstatResult.stdout),
			parseNumstat(stagedNumstatResult.stdout),
		);
		const files = await Promise.all(
			changedLines.map((line) => fileSummaryFromStatusLine(root, line, stats)),
		);
		const totals = files.reduce(
			(acc, file) => {
				acc.additions += file.additions;
				acc.deletions += file.deletions;
				if (file.binary) acc.binaryFiles++;
				if (file.staged) acc.stagedFiles++;
				if (file.unstaged) acc.unstagedFiles++;
				if (file.state === "untracked") acc.untrackedFiles++;
				if (file.state === "conflict") acc.conflictFiles++;
				return acc;
			},
			{
				additions: 0,
				deletions: 0,
				binaryFiles: 0,
				stagedFiles: 0,
				unstagedFiles: 0,
				untrackedFiles: 0,
				conflictFiles: 0,
			},
		);

		return {
			kind: "repo",
			updatedAt,
			root,
			repoName: root.split(/[\\/]/).pop() || root,
			branch,
			totalFiles: files.length,
			...totals,
			files: files.sort(sortFiles),
		};
	} catch (error) {
		return {
			kind: "error",
			updatedAt,
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

function parseNumstat(output: string): Map<string, NumStat> {
	const stats = new Map<string, NumStat>();
	for (const line of output.split("\n")) {
		if (!line.trim()) continue;
		const [addedRaw, deletedRaw, ...pathParts] = line.split("\t");
		const path = normalizeGitPath(pathParts.join("\t"));
		if (!path) continue;
		const binary = addedRaw === "-" || deletedRaw === "-";
		stats.set(path, {
			additions: binary ? 0 : Number(addedRaw) || 0,
			deletions: binary ? 0 : Number(deletedRaw) || 0,
			binary,
		});
	}
	return stats;
}

function mergeNumstats(...maps: Map<string, NumStat>[]) {
	const merged = new Map<string, NumStat>();
	for (const map of maps) {
		for (const [path, stat] of map) {
			const current = merged.get(path) ?? {
				additions: 0,
				deletions: 0,
				binary: false,
			};
			merged.set(path, {
				additions: current.additions + stat.additions,
				deletions: current.deletions + stat.deletions,
				binary: current.binary || stat.binary,
			});
		}
	}
	return merged;
}

async function fileSummaryFromStatusLine(
	root: string,
	line: string,
	stats: Map<string, NumStat>,
): Promise<FileSummary> {
	const x = line[0] ?? " ";
	const y = line[1] ?? " ";
	const rawPath = normalizeGitPath(line.slice(3));
	const path = rawPath.includes(" -> ")
		? rawPath.split(" -> ").pop()!
		: rawPath;
	const state = classifyStatus(x, y);
	const diffStat = stats.get(path) ?? stats.get(rawPath);
	const fileStat = diffStat ??
		(state === "untracked"
			? await summarizeUntrackedFile(root, path)
			: undefined) ?? { additions: 0, deletions: 0, binary: false };

	return {
		path,
		state,
		staged: isStagedStatus(x, y),
		unstaged: isUnstagedStatus(x, y),
		additions: fileStat.additions,
		deletions: fileStat.deletions,
		binary: fileStat.binary,
	};
}

function classifyStatus(x: string, y: string): FileState {
	if (x === "?" && y === "?") return "untracked";
	if (isConflictStatus(x, y)) return "conflict";
	if (x === "R" || y === "R") return "renamed";
	if (x === "D" || y === "D") return "deleted";
	if (isStagedStatus(x, y)) return "staged";
	return "modified";
}

function isConflictStatus(x: string, y: string) {
	return (
		x === "U" ||
		y === "U" ||
		["AA", "DD", "AU", "UA", "DU", "UD"].includes(`${x}${y}`)
	);
}

function isStagedStatus(x: string, y: string) {
	return !isConflictStatus(x, y) && x !== " " && x !== "?" && x !== "!";
}

function isUnstagedStatus(x: string, y: string) {
	return !isConflictStatus(x, y) && y !== " " && y !== "?" && y !== "!";
}

function sortFiles(a: FileSummary, b: FileSummary) {
	const weight: Record<FileState, number> = {
		conflict: 0,
		staged: 1,
		modified: 2,
		deleted: 3,
		renamed: 4,
		untracked: 5,
	};
	const byState = weight[a.state] - weight[b.state];
	if (byState !== 0) return byState;
	const bySize = b.additions + b.deletions - (a.additions + a.deletions);
	if (bySize !== 0) return bySize;
	return a.path.localeCompare(b.path);
}

function renderFileRow(file: FileSummary, width: number, theme: Theme) {
	const marker = stateMarker(file.state, theme);
	const stat = file.binary
		? theme.fg("warning", "bin")
		: `${theme.fg("success", `+${file.additions}`)} ${theme.fg("error", `-${file.deletions}`)}`;
	const statWidth = visibleWidth(stat);
	const pathWidth = Math.max(4, width - statWidth - 4);
	const label = truncateToWidth(file.path, pathWidth, "…");
	const left = ` ${marker} ${label}`;
	const padding = " ".repeat(
		Math.max(1, width - visibleWidth(left) - statWidth),
	);
	return left + padding + stat;
}

function stateMarker(state: FileState, theme: Theme) {
	switch (state) {
		case "conflict":
			return theme.fg("error", "!");
		case "staged":
			return theme.fg("success", "●");
		case "modified":
			return theme.fg("warning", "○");
		case "deleted":
			return theme.fg("error", "−");
		case "renamed":
			return theme.fg("accent", "↪");
		case "untracked":
			return theme.fg("dim", "?");
	}
}

function summaryLine(
	snapshot: Extract<DiffSnapshot, { kind: "repo" }>,
	theme: Theme,
) {
	if (snapshot.totalFiles === 0) return theme.fg("success", "clean");
	const chunks: string[] = [];
	if (snapshot.conflictFiles)
		chunks.push(theme.fg("error", `${snapshot.conflictFiles} conflicts`));
	if (snapshot.stagedFiles)
		chunks.push(theme.fg("success", `${snapshot.stagedFiles} staged`));
	if (snapshot.unstagedFiles)
		chunks.push(theme.fg("warning", `${snapshot.unstagedFiles} changed`));
	if (snapshot.untrackedFiles)
		chunks.push(theme.fg("dim", `${snapshot.untrackedFiles} new`));
	if (snapshot.binaryFiles)
		chunks.push(theme.fg("warning", `${snapshot.binaryFiles} binary`));
	return chunks.join(theme.fg("dim", " • "));
}

function formatStatus(
	snapshot: DiffSnapshot,
	theme: Theme,
): string | undefined {
	if (snapshot.kind === "loading") return theme.fg("dim", "git: loading");
	if (snapshot.kind === "not-git") return undefined;
	if (snapshot.kind === "error") return theme.fg("error", "git: error");
	if (snapshot.totalFiles === 0) return theme.fg("success", "git clean");
	return `${theme.fg("warning", `${snapshot.totalFiles} files`)} ${theme.fg("success", `+${snapshot.additions}`)} ${theme.fg("error", `-${snapshot.deletions}`)}`;
}

function parseBranchLine(branchLine: string | undefined) {
	if (!branchLine) return "unknown";
	const value = branchLine.slice(3).trim();
	const noCommits = value.match(/^No commits yet on (.+)$/);
	return noCommits ? `${noCommits[1]} (no commits)` : value;
}

async function summarizeUntrackedFile(
	root: string,
	path: string,
): Promise<NumStat> {
	try {
		const absolutePath = resolve(root, path);
		const fileInfo = await stat(absolutePath);
		if (!fileInfo.isFile())
			return { additions: 0, deletions: 0, binary: false };
		if (fileInfo.size > 2_000_000)
			return { additions: 0, deletions: 0, binary: true };

		const buffer = await readFile(absolutePath);
		if (isBinaryBuffer(buffer))
			return { additions: 0, deletions: 0, binary: true };
		return { additions: countLines(buffer), deletions: 0, binary: false };
	} catch {
		return { additions: 0, deletions: 0, binary: false };
	}
}

function isBinaryBuffer(buffer: Buffer) {
	const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
	if (sample.includes(0)) return true;
	let suspicious = 0;
	for (const byte of sample) {
		const allowedControl = byte === 9 || byte === 10 || byte === 13;
		if (!allowedControl && byte < 32) suspicious++;
	}
	return sample.length > 0 && suspicious / sample.length > 0.3;
}

function countLines(buffer: Buffer) {
	if (buffer.length === 0) return 0;
	let lines = 0;
	for (const byte of buffer) {
		if (byte === 10) lines++;
	}
	return buffer[buffer.length - 1] === 10 ? lines : lines + 1;
}

function normalizeGitPath(path: string) {
	return path.trim().replace(/^"|"$/g, "");
}

function firstLine(text: string) {
	return (
		text
			.split("\n")
			.find((line) => line.trim())
			?.trim() ?? "Unknown git error"
	);
}

function wrapWords(text: string, width: number) {
	const words = text.split(/\s+/);
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		if (!current) {
			current = word;
			continue;
		}
		if (visibleWidth(`${current} ${word}`) > width) {
			lines.push(current);
			current = word;
		} else {
			current += ` ${word}`;
		}
	}
	if (current) lines.push(current);
	return lines.length ? lines : [text];
}

function relativeTime(timestamp: number) {
	const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
	if (seconds < 2) return "just now";
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ago`;
}

function separatorLine(innerWidth: number, theme: Theme) {
	const border = theme.fg("border", "│");
	const rule = theme.fg("borderMuted", "─".repeat(innerWidth));
	return `${border}${rule}${border}`;
}
