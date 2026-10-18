import { z } from 'zod';
import type { PortalConfig } from './config';
import { EXECUTION_ENVIRONMENTS, type ExecutionEnvironment, type TargetBindings } from './contracts';

/**
 * Target profiles are trusted server configuration. Request bodies reference
 * a profile ID; they never supply an origin, credential, or credential path.
 */

const staffCredentialSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(1),
    userId: z.string().min(1).optional(),
  })
  .strict();

const credentialsSchema = z
  .object({
    version: z.literal(1),
    profiles: z.record(
      z.string().min(1),
      z
        .object({
          admin: staffCredentialSchema.optional(),
          staff: staffCredentialSchema.optional(),
          proctors: z.array(staffCredentialSchema).max(20).optional(),
          candidates: z
            .array(staffCredentialSchema.extend({ userId: z.string().min(1) }).strict())
            .max(500)
            .optional(),
        })
        .strict(),
    ),
  })
  .strict();

export type StaffCredential = z.infer<typeof staffCredentialSchema>;
export type CredentialBundle = z.infer<typeof credentialsSchema>['profiles'][string];

const targetProfileSchema = z
  .object({
    id: z.string().min(1).max(120),
    label: z.string().min(1).max(200),
    environment: z.enum(EXECUTION_ENVIRONMENTS),
    origin: z.string().min(1).max(2048),
    credentialRef: z.string().min(1).max(120),
    organizationId: z.string().min(1).max(255).optional(),
    revision: z.string().min(1).max(120),
    enabled: z.boolean().default(true),
    description: z.string().max(500).optional(),
  })
  .strict();

export type TargetProfile = z.infer<typeof targetProfileSchema>;

const targetsFileSchema = z
  .object({
    version: z.literal(1),
    profiles: z.array(targetProfileSchema).max(50),
  })
  .strict();

export interface PublicTargetProfile {
  id: string;
  label: string;
  environment: ExecutionEnvironment;
  origin: string;
  revision: string;
  enabled: boolean;
  ready: boolean;
  detail: string;
}

export interface ResolvedTarget {
  id: string;
  environment: ExecutionEnvironment;
  origin: string;
  revision: string;
  credentialRef: string;
  organizationId: string | null;
  credentials: CredentialBundle | null;
}

function validateOrigin(origin: string, environment: ExecutionEnvironment): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`Target origin must be an absolute URL: ${origin}`);
  }
  if (url.username || url.password) {
    throw new Error('Target origin must not embed credentials.');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Target origin must not contain a path, query, or fragment.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (environment === 'isolated') {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Isolated target must use http or https.');
    }
  } else if (url.protocol !== 'https:' || loopback) {
    throw new Error(`${environment} targets must be a non-loopback https origin.`);
  }
  return url.origin;
}

export class TargetRegistry {
  private readonly profiles = new Map<string, TargetProfile>();
  private readonly credentials = new Map<string, CredentialBundle>();
  private readonly config: PortalConfig;

  constructor(config: PortalConfig) {
    this.config = config;
    if (config.targetsJson) {
      const parsed = targetsFileSchema.parse(JSON.parse(config.targetsJson));
      for (const profile of parsed.profiles) {
        if (this.profiles.has(profile.id)) throw new Error(`Duplicate target profile id: ${profile.id}`);
        this.profiles.set(profile.id, { ...profile, origin: validateOrigin(profile.origin, profile.environment) });
      }
    }
    if (config.credentialsJson) {
      const parsed = credentialsSchema.parse(JSON.parse(config.credentialsJson));
      for (const [ref, bundle] of Object.entries(parsed.profiles)) {
        this.credentials.set(ref, bundle);
      }
    }
  }

  list(): TargetProfile[] {
    return [...this.profiles.values()].sort((a, b) => `${a.environment}:${a.id}`.localeCompare(`${b.environment}:${b.id}`));
  }

  get(id: string): TargetProfile | null {
    return this.profiles.get(id) ?? null;
  }

  credentialsFor(profile: TargetProfile): CredentialBundle | null {
    return this.credentials.get(profile.credentialRef) ?? null;
  }

  readiness(profile: TargetProfile): { ready: boolean; detail: string } {
    if (!profile.enabled) return { ready: false, detail: 'Profile is disabled.' };
    if (profile.environment === 'production' && !this.config.productionEnabled) {
      return { ready: false, detail: 'Production execution is disabled (PORTAL_PRODUCTION_ENABLED=false).' };
    }
    const bundle = this.credentialsFor(profile);
    if (!bundle) {
      return { ready: false, detail: `Credential reference "${profile.credentialRef}" is not configured.` };
    }
    if (!bundle.staff && !bundle.admin) {
      return { ready: false, detail: 'Credential bundle has no staff/admin principal.' };
    }
    return { ready: true, detail: 'Ready.' };
  }

  listPublic(): PublicTargetProfile[] {
    return this.list().map((profile) => {
      const readiness = this.readiness(profile);
      return {
        id: profile.id,
        label: profile.label,
        environment: profile.environment,
        origin: profile.origin,
        revision: profile.revision,
        enabled: profile.enabled,
        ready: readiness.ready,
        detail: readiness.detail,
      };
    });
  }

  resolve(id: string, expected: ExecutionEnvironment): ResolvedTarget {
    const profile = this.get(id);
    if (!profile) throw new Error(`Unknown target profile: ${id}`);
    if (profile.environment !== expected) {
      throw new Error(`Target profile ${id} is ${profile.environment}, not ${expected}.`);
    }
    const readiness = this.readiness(profile);
    if (!readiness.ready) throw new Error(`Target profile ${id} is not ready: ${readiness.detail}`);
    return {
      id: profile.id,
      environment: profile.environment,
      origin: profile.origin,
      revision: profile.revision,
      credentialRef: profile.credentialRef,
      organizationId: profile.organizationId ?? null,
      credentials: this.credentialsFor(profile),
    };
  }

  /**
   * Resolve the bindings needed for a set of environments. Missing remote
   * bindings are reported, never defaulted from the repository's hardcoded
   * deployment URL.
   */
  resolveBindings(
    bindings: TargetBindings,
    environments: readonly ExecutionEnvironment[],
  ): { targets: Map<ExecutionEnvironment, ResolvedTarget>; blockers: string[] } {
    const targets = new Map<ExecutionEnvironment, ResolvedTarget>();
    const blockers: string[] = [];
    for (const environment of new Set(environments)) {
      const id = bindings[environment];
      if (!id) {
        if (environment === 'isolated') continue;
        blockers.push(`No ${environment} target profile is bound.`);
        continue;
      }
      try {
        targets.set(environment, this.resolve(id, environment));
      } catch (error) {
        blockers.push(error instanceof Error ? error.message : String(error));
      }
    }
    return { targets, blockers };
  }
}
