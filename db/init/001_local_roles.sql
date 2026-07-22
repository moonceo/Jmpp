-- Local Docker roles only. Production credentials must come from the platform
-- secret manager and must not reuse these passwords.
CREATE ROLE jumunpangpang_app LOGIN PASSWORD 'app';
CREATE ROLE jumunpangpang_worker LOGIN PASSWORD 'worker' BYPASSRLS;
