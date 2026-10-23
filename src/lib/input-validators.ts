/**
 * Validators for caller-supplied values that end up as process arguments or
 * as segments of an outbound URL path.
 */

// Docker's own rule for container names: starts alphanumeric, then letters,
// digits, underscore, dot or dash. The leading alphanumeric keeps a name from
// ever being read as an option by `docker logs`.
const CONTAINER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/

/** True when `name` is a syntactically valid Docker container name. */
export function isValidContainerName(name: string): boolean {
  return CONTAINER_NAME_RE.test(name)
}

// A GitHub owner or repository name: letters, digits, underscore, dot, dash.
const GITHUB_SEGMENT_RE = /^[A-Za-z0-9_.-]+$/

function isGitHubSegment(segment: string): boolean {
  // A segment made only of dots ("." or "..") would be resolved as a path
  // traversal by the URL parser, so it is not a name.
  return GITHUB_SEGMENT_RE.test(segment) && !/^\.+$/.test(segment)
}

/**
 * Split `owner/repo` into its two parts. Returns null unless the value is
 * exactly two valid GitHub name segments separated by one slash.
 */
export function parseGitHubRepo(fullName: string): { owner: string; repo: string } | null {
  const parts = fullName.split('/')
  if (parts.length !== 2) return null
  const [owner, repo] = parts
  if (!isGitHubSegment(owner) || !isGitHubSegment(repo)) return null
  return { owner, repo }
}
