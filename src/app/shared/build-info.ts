interface CommitInfo {
  commitHash: string;
  commitDateTime: string;
}

const UNKNOWN_COMMIT_INFO: CommitInfo = { commitHash: 'unknown', commitDateTime: 'unknown' };

// no-store: this describes the deployed build and must never come from the browser cache.
// A missing front file is answered by nginx's SPA fallback with index.html, which fails to
// parse as JSON and lands in the catch the same way a network error does.
async function fetchCommitInfo(url: string): Promise<CommitInfo> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    return response.ok ? ((await response.json()) as CommitInfo) : UNKNOWN_COMMIT_INFO;
  } catch {
    return UNKNOWN_COMMIT_INFO;
  }
}

export async function logBuildInfo(): Promise<void> {
  const [front, back] = await Promise.all([
    fetchCommitInfo('/assets/build-info.json'),
    fetchCommitInfo('/api/debug/commit-info'),
  ]);
  console.log(`Latest front commit: [${front.commitHash}, ${front.commitDateTime}]`);
  console.log(`Latest back commit: [${back.commitHash}, ${back.commitDateTime}]`);
}
