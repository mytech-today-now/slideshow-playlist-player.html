CREATE TABLE IF NOT EXISTS blend_profile_sync_profiles (
  profile_guid uuid PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  experience jsonb,
  github_sha text,
  github_synced_revision bigint NOT NULL DEFAULT 0 CHECK (github_synced_revision >= 0),
  github_status text NOT NULL DEFAULT 'local_only',
  github_error_code text,
  recovery_generation integer NOT NULL DEFAULT 1 CHECK (recovery_generation >= 1),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blend_profile_sync_devices (
  device_id uuid PRIMARY KEY,
  profile_guid uuid NOT NULL REFERENCES blend_profile_sync_profiles(profile_guid) ON DELETE CASCADE,
  credential_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS blend_profile_sync_devices_profile_idx
  ON blend_profile_sync_devices(profile_guid, revoked_at);

CREATE TABLE IF NOT EXISTS blend_profile_sync_recovery_keys (
  profile_guid uuid NOT NULL REFERENCES blend_profile_sync_profiles(profile_guid) ON DELETE CASCADE,
  key_hash char(64) NOT NULL,
  generation integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  PRIMARY KEY (profile_guid, key_hash)
);

CREATE TABLE IF NOT EXISTS blend_profile_sync_pending_rotations (
  rotation_id uuid PRIMARY KEY,
  profile_guid uuid NOT NULL REFERENCES blend_profile_sync_profiles(profile_guid) ON DELETE CASCADE,
  generation integer NOT NULL,
  key_hashes char(64)[] NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_guid)
);

CREATE TABLE IF NOT EXISTS blend_profile_sync_shares (
  token_hash char(64) PRIMARY KEY,
  profile_guid uuid NOT NULL REFERENCES blend_profile_sync_profiles(profile_guid) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);

CREATE TABLE IF NOT EXISTS blend_profile_sync_locks (
  profile_guid uuid PRIMARY KEY REFERENCES blend_profile_sync_profiles(profile_guid) ON DELETE CASCADE,
  token_hash char(64) NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS blend_profile_sync_outbox (
  profile_guid uuid PRIMARY KEY REFERENCES blend_profile_sync_profiles(profile_guid) ON DELETE CASCADE,
  desired_revision bigint NOT NULL,
  operation text NOT NULL CHECK (operation IN ('put', 'delete')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  blocked_by_conflict boolean NOT NULL DEFAULT false,
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blend_profile_sync_outbox_due_idx
  ON blend_profile_sync_outbox(next_attempt_at, lease_until)
  WHERE blocked_by_conflict = false;

CREATE TABLE IF NOT EXISTS blend_profile_sync_operations (
  profile_guid uuid NOT NULL REFERENCES blend_profile_sync_profiles(profile_guid) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  payload_hash char(64) NOT NULL,
  response_revision bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_guid, idempotency_key)
);

CREATE TABLE IF NOT EXISTS blend_profile_sync_admin_challenges (
  challenge_id uuid PRIMARY KEY,
  token_hash char(64) NOT NULL,
  profile_guid uuid NOT NULL REFERENCES blend_profile_sync_profiles(profile_guid) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation IN ('delete_experience')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blend_profile_sync_audit (
  audit_id bigserial PRIMARY KEY,
  profile_guid uuid,
  action text NOT NULL,
  outcome text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blend_profile_sync_audit_created_idx
  ON blend_profile_sync_audit(created_at DESC);
