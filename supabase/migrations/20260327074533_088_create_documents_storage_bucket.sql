/*
  # Create documents storage bucket

  1. Storage
    - Creates `documents` bucket for borrower document uploads
    - Sets up RLS policies for secure file access
    
  2. Security
    - Borrowers can upload to their own folder
    - Borrowers can read their own files
    - Internal users (reviewers, admins, brokers) can read all files
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Borrowers can upload to own folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] = 'borrowers' AND
  (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "Borrowers can read own files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] = 'borrowers' AND
  (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "Internal users can read all documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'documents' AND
  EXISTS (
    SELECT 1 FROM user_accounts
    WHERE id = auth.uid()
    AND user_role IN ('reviewer', 'admin', 'broker')
  )
);

CREATE POLICY "Borrowers can update own files"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] = 'borrowers' AND
  (storage.foldername(name))[2] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] = 'borrowers' AND
  (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "Borrowers can delete own files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] = 'borrowers' AND
  (storage.foldername(name))[2] = auth.uid()::text
);
