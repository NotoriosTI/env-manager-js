import { describe, expect, it } from 'vitest';

import { CANONICAL_ORIGINS, ORIGIN_ALIASES, parseEnvironments } from '../src/environment.js';

describe('parseEnvironments', () => {
  it('returns empty object when no environments key', () => {
    expect(parseEnvironments({})).toEqual({});
  });

  it('parses valid local environment with dotenv_path', () => {
    const environments = parseEnvironments({
      environments: {
        development: {
          origin: 'local',
          dotenv_path: '.env.dev',
        },
      },
    });

    expect(environments.development).toMatchObject({
      origin: 'local',
      dotenvPath: '.env.dev',
      gcpProjectId: null,
      isDefault: false,
    });
  });

  it('parses valid GCP environment with gcp_project_id', () => {
    const environments = parseEnvironments({
      environments: {
        production: {
          origin: 'gcp',
          gcp_project_id: 'prod-project',
        },
      },
    });

    expect(environments.production).toMatchObject({
      origin: 'gcp',
      dotenvPath: null,
      gcpProjectId: 'prod-project',
      isDefault: false,
    });
  });

  it('throws when origin is missing', () => {
    expect(() =>
      parseEnvironments({
        environments: {
          staging: {},
        },
      }),
    ).toThrow("Missing 'origin' key in environment 'staging'");
  });

  it('throws on invalid origin', () => {
    expect(() =>
      parseEnvironments({
        environments: {
          staging: {
            origin: 'vault',
          },
        },
      }),
    ).toThrow("Invalid origin 'vault' in environment 'staging'. Must be 'local' or 'gcp' (or an alias)");
  });

  it.each(['dotenv', 'env-file', '.env'])('alias %s resolves to local', (alias) => {
    const environments = parseEnvironments({
      environments: {
        dev: { origin: alias },
      },
    });
    expect(environments.dev.origin).toBe('local');
  });

  it.each(['gcp-secretmanager', 'gcp-secret-manager', 'secretmanager'])(
    'alias %s resolves to gcp',
    (alias) => {
      const environments = parseEnvironments({
        environments: {
          prod: { origin: alias, gcp_project_id: 'my-project' },
        },
      });
      expect(environments.prod.origin).toBe('gcp');
    },
  );

  it('all ORIGIN_ALIASES values are canonical origins', () => {
    for (const target of Object.values(ORIGIN_ALIASES)) {
      expect(CANONICAL_ORIGINS.has(target)).toBe(true);
    }
  });

  it('local origin defaults dotenv_path to ".env"', () => {
    const environments = parseEnvironments({
      environments: {
        development: {
          origin: 'local',
        },
      },
    });

    expect(environments.development.dotenvPath).toBe('.env');
  });

  it('rechaza fallback_to_individual false en un entorno local', () => {
    expect(() =>
      parseEnvironments({
        environments: {
          development: {
            origin: 'local',
            fallback_to_individual: false,
          },
        },
      }),
    ).toThrow(/cannot be false without 'consolidated_secret'/);
  });

  it('local origin keeps explicit dotenv_path', () => {
    const environments = parseEnvironments({
      environments: {
        development: {
          origin: 'local',
          dotenv_path: '.env.custom',
        },
      },
    });

    expect(environments.development.dotenvPath).toBe('.env.custom');
  });

  it('GCP without gcp_project_id throws', () => {
    expect(() =>
      parseEnvironments({
        environments: {
          production: {
            origin: 'gcp',
          },
        },
      }),
    ).toThrow("Missing 'gcp_project_id' for GCP environment 'production'");
  });

  it('GCP ignores dotenv_path', () => {
    const environments = parseEnvironments({
      environments: {
        production: {
          origin: 'gcp',
          dotenv_path: '.env.should-ignore',
          gcp_project_id: 'prod-project',
        },
      },
    });

    expect(environments.production).toMatchObject({
      origin: 'gcp',
      dotenvPath: null,
      gcpProjectId: 'prod-project',
    });
  });

  it('local ignores gcp_project_id', () => {
    const environments = parseEnvironments({
      environments: {
        development: {
          origin: 'local',
          dotenv_path: '.env.dev',
          gcp_project_id: 'ignored-project',
        },
      },
    });

    expect(environments.development).toMatchObject({
      origin: 'local',
      dotenvPath: '.env.dev',
      gcpProjectId: null,
    });
  });

  it('dotenv_path filename kept as-is', () => {
    const environments = parseEnvironments({
      environments: {
        qa: {
          origin: 'local',
          dotenv_path: 'qa.env',
        },
      },
    });

    expect(environments.qa.dotenvPath).toBe('qa.env');
  });

  it('dotenv_path full path kept as-is', () => {
    const environments = parseEnvironments({
      environments: {
        qa: {
          origin: 'local',
          dotenv_path: '/tmp/custom/.env.qa',
        },
      },
    });

    expect(environments.qa.dotenvPath).toBe('/tmp/custom/.env.qa');
  });

  it('throws when environments is not a mapping', () => {
    expect(() =>
      parseEnvironments({
        environments: ['development'],
      }),
    ).toThrow("Expected 'environments' to be a mapping");
  });

  it('throws when individual env is not a mapping', () => {
    expect(() =>
      parseEnvironments({
        environments: {
          staging: 'local',
        },
      }),
    ).toThrow("Expected environment 'staging' to be a mapping");
  });

  it('multiple environments parse independently', () => {
    const environments = parseEnvironments({
      environments: {
        development: {
          origin: 'local',
          dotenv_path: '.env.dev',
        },
        production: {
          origin: 'gcp',
          gcp_project_id: 'prod-project',
        },
      },
    });

    expect(environments.development).toMatchObject({
      origin: 'local',
      dotenvPath: '.env.dev',
      gcpProjectId: null,
    });
    expect(environments.production).toMatchObject({
      origin: 'gcp',
      dotenvPath: null,
      gcpProjectId: 'prod-project',
    });
  });

  it('origin is normalized to lowercase', () => {
    const environments = parseEnvironments({
      environments: {
        staging: {
          origin: 'GCP',
          gcp_project_id: 'staging-project',
        },
      },
    });

    expect(environments.staging.origin).toBe('gcp');
  });

  it('EnvironmentConfig fields are accessible', () => {
    const environments = parseEnvironments({
      environments: {
        staging: {
          origin: 'local',
          dotenv_path: '.env.staging',
          default: true,
        },
      },
    });

    const staging = environments.staging;
    expect(staging.origin).toBe('local');
    expect(staging.dotenvPath).toBe('.env.staging');
    expect(staging.gcpProjectId).toBeNull();
    expect(staging.isDefault).toBe(true);
  });
});
