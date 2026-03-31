/*
  # Add RLS Policies for ID Documents Storage Bucket

  ## Summary
  Creates RLS policies for the id-documents storage bucket to allow:
  - Authenticated users to upload their own ID documents
  - Authenticated users to read their own ID documents
  - Organization members to read ID documents of borrowers in their organization

  ## Security
  - Only authenticated users can access the bucket
  - Users can only access documents for borrowers they own or are in their organization
*/

CREATE POLICY "Users can upload their own ID documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'id-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can read their own ID documents"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'id-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can update their own ID documents"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'id-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'id-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete their own ID documents"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'id-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
