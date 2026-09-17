-- Create storage bucket for file uploads (farmer photos, documents, etc.)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'agrichain',
  'agrichain',
  false,
  52428800, -- 50MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel']
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to the private folder
CREATE POLICY "allow_auth_uploads_private"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'agrichain' AND (storage.foldername(name))[1] = 'private');

-- Allow authenticated users to read their uploads
CREATE POLICY "allow_auth_reads_private"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'agrichain' AND (storage.foldername(name))[1] = 'private');

-- Allow authenticated users to update their uploads
CREATE POLICY "allow_auth_updates_private"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'agrichain' AND (storage.foldername(name))[1] = 'private');

-- Allow authenticated users to delete their uploads
CREATE POLICY "allow_auth_deletes_private"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'agrichain' AND (storage.foldername(name))[1] = 'private');

-- Public folder: anyone can read, only authenticated can upload
CREATE POLICY "allow_public_reads"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'agrichain' AND (storage.foldername(name))[1] = 'public');

CREATE POLICY "allow_auth_uploads_public"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'agrichain' AND (storage.foldername(name))[1] = 'public');

CREATE POLICY "allow_auth_updates_public"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'agrichain' AND (storage.foldername(name))[1] = 'public');

CREATE POLICY "allow_auth_deletes_public"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'agrichain' AND (storage.foldername(name))[1] = 'public');
