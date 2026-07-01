/*
  # Encrypt SSNs at rest

  borrowers.ssn_encrypted and co_borrowers.ssn_encrypted held RAW 9-digit SSNs
  despite the column name. This migration:

  1. Generates a 256-bit key INSIDE the database (Supabase Vault) — the key
     never appears in git or client code.
  2. fn_encrypt_ssn / fn_decrypt_ssn (SECURITY DEFINER, pgcrypto PGP + AES-256).
     Decrypt is executable ONLY by service_role (edge functions: plaid-link,
     pull-credit). Encrypt/decrypt pass through non-plaintext/non-ciphertext
     values so legacy rows and re-saves are safe.
  3. Triggers on borrowers/co_borrowers encrypt any plaintext SSN on write —
     the apply page keeps sending plaintext over TLS; it never lands at rest.
  4. get_full_ssn(borrower_id) / get_co_full_ssn(co_borrower_id) RPCs for the
     UI: allowed for staff, the borrower's manager chain, or the borrower
     themself (profile prefill / broker reveal / URLA generation).
  5. Backfills all existing plaintext rows.
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 1. Key lives in Vault, generated at migration time (never in git).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'ssn_encryption_key') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'ssn_encryption_key');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_ssn_key()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'ssn_encryption_key';
$$;
REVOKE ALL ON FUNCTION fn_ssn_key() FROM PUBLIC, anon, authenticated;

-- 2. Encrypt / decrypt (passthrough-safe in both directions).
CREATE OR REPLACE FUNCTION fn_encrypt_ssn(p text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p IS NULL OR p !~ '^\d{9}$' THEN
    RETURN p; -- not a plaintext SSN (already ciphertext, partial, or empty)
  END IF;
  RETURN armor(pgp_sym_encrypt(p, fn_ssn_key(), 'cipher-algo=aes256'));
END $$;
REVOKE ALL ON FUNCTION fn_encrypt_ssn(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION fn_decrypt_ssn(p text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p IS NULL OR p NOT LIKE '-----BEGIN PGP MESSAGE-----%' THEN
    RETURN p; -- legacy plaintext or empty: passthrough
  END IF;
  RETURN pgp_sym_decrypt(dearmor(p), fn_ssn_key());
END $$;
REVOKE ALL ON FUNCTION fn_decrypt_ssn(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_decrypt_ssn(text) TO service_role;

-- 3. Encrypt-on-write triggers.
CREATE OR REPLACE FUNCTION trg_encrypt_ssn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  NEW.ssn_encrypted := fn_encrypt_ssn(NEW.ssn_encrypted);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS encrypt_ssn_borrowers ON borrowers;
CREATE TRIGGER encrypt_ssn_borrowers
  BEFORE INSERT OR UPDATE OF ssn_encrypted ON borrowers
  FOR EACH ROW EXECUTE FUNCTION trg_encrypt_ssn();

DROP TRIGGER IF EXISTS encrypt_ssn_co_borrowers ON co_borrowers;
CREATE TRIGGER encrypt_ssn_co_borrowers
  BEFORE INSERT OR UPDATE OF ssn_encrypted ON co_borrowers
  FOR EACH ROW EXECUTE FUNCTION trg_encrypt_ssn();

-- 4. Gated RPCs for the UI.
CREATE OR REPLACE FUNCTION get_full_ssn(p_borrower_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row borrowers%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM borrowers WHERE id = p_borrower_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_row.user_id IS DISTINCT FROM auth.uid()
     AND NOT fn_caller_manages_borrower(p_borrower_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN fn_decrypt_ssn(v_row.ssn_encrypted);
END $$;
GRANT EXECUTE ON FUNCTION get_full_ssn(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION get_co_full_ssn(p_co_borrower_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ssn text;
  v_borrower_id uuid;
  v_owner uuid;
BEGIN
  SELECT cb.ssn_encrypted, cb.borrower_id, b.user_id
    INTO v_ssn, v_borrower_id, v_owner
  FROM co_borrowers cb JOIN borrowers b ON b.id = cb.borrower_id
  WHERE cb.id = p_co_borrower_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_owner IS DISTINCT FROM auth.uid()
     AND NOT fn_caller_manages_borrower(v_borrower_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN fn_decrypt_ssn(v_ssn);
END $$;
GRANT EXECUTE ON FUNCTION get_co_full_ssn(uuid) TO authenticated;

-- 5. Backfill existing plaintext rows (trigger passthrough keeps this safe to re-run).
UPDATE borrowers SET ssn_encrypted = fn_encrypt_ssn(ssn_encrypted) WHERE ssn_encrypted ~ '^\d{9}$';
UPDATE co_borrowers SET ssn_encrypted = fn_encrypt_ssn(ssn_encrypted) WHERE ssn_encrypted ~ '^\d{9}$';

NOTIFY pgrst, 'reload schema';
