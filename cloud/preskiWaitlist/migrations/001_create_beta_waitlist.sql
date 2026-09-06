CREATE TABLE preski_labs.beta_waitlist_signups (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  email_normalized text NOT NULL UNIQUE,
  product text NOT NULL,
  device text NOT NULL,
  wattbike_access text NOT NULL,
  adult_or_guardian boolean NOT NULL,
  beta_consent boolean NOT NULL,
  beta_consent_at timestamptz NOT NULL,
  marketing_consent boolean NOT NULL DEFAULT false,
  marketing_consent_at timestamptz,
  consent_version text NOT NULL,
  status text NOT NULL DEFAULT 'waitlisted',
  invited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT beta_waitlist_first_name_length CHECK (char_length(first_name) BETWEEN 1 AND 80),
  CONSTRAINT beta_waitlist_last_name_length CHECK (char_length(last_name) BETWEEN 1 AND 80),
  CONSTRAINT beta_waitlist_email_length CHECK (char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT beta_waitlist_product CHECK (product IN ('tracklab-bmx', 'tooltrack', 'both')),
  CONSTRAINT beta_waitlist_device CHECK (
    device IN ('ipad', 'iphone', 'android', 'android-tablet', 'android-phone', 'mac', 'windows', 'other')
  ),
  CONSTRAINT beta_waitlist_wattbike_access CHECK (wattbike_access IN ('yes', 'no', 'unsure')),
  CONSTRAINT beta_waitlist_adult CHECK (adult_or_guardian),
  CONSTRAINT beta_waitlist_beta_consent CHECK (beta_consent),
  CONSTRAINT beta_waitlist_status CHECK (status IN ('waitlisted', 'invited', 'testing', 'removed'))
);

CREATE INDEX beta_waitlist_product_created_idx
  ON preski_labs.beta_waitlist_signups (product, created_at DESC);

CREATE INDEX beta_waitlist_status_created_idx
  ON preski_labs.beta_waitlist_signups (status, created_at DESC);
