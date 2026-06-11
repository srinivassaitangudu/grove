import { execSync } from 'child_process';
import path from 'path';
import { existsSync, rmSync } from 'fs';

export function getRepoRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
  } catch {
    throw new Error('Not inside a git repository.');
  }
}

export function getRepoName(repoRoot: string): string {
  return path.basename(repoRoot);
}

export function getWorktreeDir(repoRoot: string, agentId: string): string {
  const repoName = getRepoName(repoRoot);
  return path.join(path.dirname(repoRoot), `${repoName}-${agentId}`);
}

export function worktreeExists(worktreeDir: string): boolean {
  return existsSync(worktreeDir);
}

export function createWorktree(repoRoot: string, worktreeDir: string, branch: string): void {
  // Clear any stale/missing worktree registrations before adding
  try {
    execSync(`git -C "${repoRoot}" worktree prune`, { stdio: 'pipe' });
  } catch {
    // non-fatal
  }

  // Check if branch exists locally
  try {
    execSync(`git -C "${repoRoot}" show-ref --verify --quiet refs/heads/${branch}`, { stdio: 'pipe' });
    // Branch exists locally — use it
    execSync(`git -C "${repoRoot}" worktree add "${worktreeDir}" "${branch}"`, { stdio: 'inherit' });
    return;
  } catch {
    // Branch doesn't exist locally
  }

  // Check if branch exists on remote
  try {
    const remote = execSync(`git -C "${repoRoot}" ls-remote --heads origin ${branch}`, { encoding: 'utf-8' });
    if (remote.includes(branch)) {
      execSync(`git -C "${repoRoot}" fetch origin ${branch}`, { stdio: 'inherit' });
      execSync(`git -C "${repoRoot}" worktree add "${worktreeDir}" -b "${branch}" "origin/${branch}"`, { stdio: 'inherit' });
      return;
    }
  } catch {
    // No remote or fetch failed
  }

  // Create new branch
  execSync(`git -C "${repoRoot}" worktree add -b "${branch}" "${worktreeDir}"`, { stdio: 'inherit' });
}

export function removeWorktree(repoRoot: string, worktreeDir: string, branch: string): void {
  if (existsSync(worktreeDir)) {
    try {
      execSync(`git -C "${repoRoot}" worktree remove "${worktreeDir}" --force`, { stdio: 'inherit' });
    } catch {
      // If git worktree remove fails, force delete using cross-platform Node.js API
      rmSync(worktreeDir, { recursive: true, force: true });
    }
  }

  // Prune worktree references
  execSync(`git -C "${repoRoot}" worktree prune`, { stdio: 'pipe' });

  // Delete branch
  try {
    execSync(`git -C "${repoRoot}" branch -D "${branch}"`, { stdio: 'pipe' });
  } catch {
    // Branch might not exist or is checked out elsewhere
  }
}

export interface WorktreeChanges {
  hasUncommitted: boolean;
  hasUntracked: boolean;
  hasUnpushed: boolean;
}

export function checkWorktreeChanges(worktreeDir: string, branch: string): WorktreeChanges {
  let hasUncommitted = false;
  let hasUntracked = false;
  let hasUnpushed = false;

  try {
    const status = execSync(`git -C "${worktreeDir}" status --porcelain`, { encoding: 'utf-8', stdio: 'pipe' });
    if (status.trim()) {
      const lines = status.trim().split('\n');
      hasUntracked = lines.some(l => l.startsWith('??'));
      hasUncommitted = lines.some(l => !l.startsWith('??'));
    }
  } catch {
    // worktree not accessible
  }

  try {
    const unpushed = execSync(`git -C "${worktreeDir}" log "origin/${branch}..HEAD" --oneline`, { encoding: 'utf-8', stdio: 'pipe' });
    hasUnpushed = unpushed.trim().length > 0;
  } catch {
    // no remote tracking branch — treat as no unpushed commits
  }

  return { hasUncommitted, hasUntracked, hasUnpushed };
}

export function listWorktrees(repoRoot: string): string[] {
  const output = execSync(`git -C "${repoRoot}" worktree list --porcelain`, { encoding: 'utf-8' });
  const worktrees: string[] = [];
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      worktrees.push(line.replace('worktree ', ''));
    }
  }
  return worktrees;
}
