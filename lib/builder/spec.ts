// The AppSpec — the single structured object the whole builder flow populates,
// whether the user came in via a template or the guided Q&A. Generation, GitHub
// publish and deploy all read from this one shape; nothing downstream should
// need the raw prompt again once it's been normalized into a spec.
//
// This mirrors the flow object sketched in the design notes:
//   { description, appType, entities, auth, roles, integrations, template }
// v0 fills it from a single prompt (see specFromPrompt); the guided flow is just
// a richer way to populate the same fields later.

export type AppType = "internal" | "public" | "saas" | "content";
export type AuthMode = "none" | "passkey" | "password" | "social";

export interface Field {
  name: string;
  // A small, deliberately closed set — these map cleanly to Postgres column
  // types in the generated schema.sql. The model is instructed to only use
  // these; anything else is coerced to "text" during normalization.
  type: "text" | "int" | "float" | "bool" | "timestamp" | "uuid" | "json";
  // Foreign key to another entity by name, if this field is a relation.
  ref?: string;
}

export interface Entity {
  name: string; // singular, lowercase noun: "client", "session", "payment"
  fields: Field[];
}

export interface AppSpec {
  description: string;
  appType: AppType;
  entities: Entity[];
  auth: AuthMode;
  roles: string[];
  integrations: string[];
  template: string | null;
}

const APP_TYPES: AppType[] = ["internal", "public", "saas", "content"];
const AUTH_MODES: AuthMode[] = ["none", "passkey", "password", "social"];
const FIELD_TYPES: Field["type"][] = [
  "text",
  "int",
  "float",
  "bool",
  "timestamp",
  "uuid",
  "json",
];

// A project name safe to use as a GitHub repo name AND a *.apps.lla.ma
// subdomain: lowercase, hyphenated, no leading/trailing/double hyphens.
export function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s || "app";
}

// Normalize whatever the model (or a template) produced into a valid AppSpec.
// Defensive on purpose: an LLM will occasionally hand back an unknown appType,
// a bogus field type, or a relation pointing at an entity it never declared.
// We repair rather than throw so a single stray value can't sink a generation.
export function normalizeSpec(raw: Partial<AppSpec> | undefined): AppSpec {
  const r = raw ?? {};
  const entities = normalizeEntities(Array.isArray(r.entities) ? r.entities : []);
  const entityNames = new Set(entities.map((e) => e.name));

  // Drop relations that point at an entity we don't actually have.
  for (const e of entities) {
    for (const f of e.fields) {
      if (f.ref && !entityNames.has(f.ref)) delete f.ref;
    }
  }

  const auth: AuthMode = AUTH_MODES.includes(r.auth as AuthMode)
    ? (r.auth as AuthMode)
    : "none";

  return {
    description: (r.description ?? "").toString().trim(),
    appType: APP_TYPES.includes(r.appType as AppType)
      ? (r.appType as AppType)
      : "internal",
    entities,
    auth,
    // Roles only make sense with auth; drop them otherwise.
    roles:
      auth === "none"
        ? []
        : (Array.isArray(r.roles) ? r.roles : [])
            .map((x) => x?.toString().trim())
            .filter((x): x is string => !!x),
    integrations: (Array.isArray(r.integrations) ? r.integrations : [])
      .map((x) => x?.toString().trim())
      .filter((x): x is string => !!x),
    template: r.template ? r.template.toString() : null,
  };
}

function normalizeEntities(raw: unknown[]): Entity[] {
  const seen = new Set<string>();
  const out: Entity[] = [];
  for (const item of raw) {
    const e = item as Partial<Entity>;
    const name = slugify((e?.name ?? "").toString()).replace(/-/g, "_");
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const fields = normalizeFields(Array.isArray(e.fields) ? e.fields : []);
    out.push({ name, fields });
  }
  return out;
}

function normalizeFields(raw: unknown[]): Field[] {
  const seen = new Set<string>(["id", "created_at"]); // reserved: always generated
  const out: Field[] = [];
  for (const item of raw) {
    const f = item as Partial<Field>;
    const name = (f?.name ?? "").toString().trim().toLowerCase().replace(/\s+/g, "_");
    if (!name || !/^[a-z][a-z0-9_]*$/.test(name) || seen.has(name)) continue;
    seen.add(name);
    const type = FIELD_TYPES.includes(f.type as Field["type"])
      ? (f.type as Field["type"])
      : "text";
    const field: Field = { name, type };
    if (f.ref) field.ref = slugify(f.ref.toString()).replace(/-/g, "_");
    out.push(field);
  }
  return out;
}
