// Project env vars are secrets: inject them into the container at runtime, and
// scrub their VALUES out of every build/run log line before it's persisted.

export function dockerEnvFlags(env: Record<string, string>): string[] {
  return Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
}

// Replace any occurrence of a secret value with *** (ignore very short values to
// avoid mangling unrelated text).
export function scrubSecrets(line: string, secretValues: string[]): string {
  let out = line;
  for (const v of secretValues) {
    if (v && v.length >= 4) out = out.split(v).join("***");
  }
  return out;
}
