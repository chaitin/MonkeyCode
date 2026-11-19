BEGIN;
ALTER TABLE hosts DROP CONSTRAINT hosts_name_check;
WITH candidates AS (
 SELECT id, btrim(report->'system'->>'hostname', U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') AS hostname FROM hosts WHERE name=''
)
UPDATE hosts h SET name=CASE
 WHEN h.status='pending' AND h.public_key IS NULL THEN '待接入宿主'
 WHEN octet_length(c.hostname) BETWEEN 1 AND 128 AND c.hostname !~ E'[\r\n]' THEN c.hostname
 ELSE 'host-' || h.id::text END
FROM candidates c WHERE h.id=c.id;
ALTER TABLE hosts ADD CONSTRAINT hosts_name_check CHECK (octet_length(name) BETWEEN 1 AND 128);
COMMIT;
