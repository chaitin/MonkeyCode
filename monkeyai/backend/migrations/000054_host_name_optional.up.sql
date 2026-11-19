BEGIN;
ALTER TABLE hosts DROP CONSTRAINT hosts_name_check;
ALTER TABLE hosts ADD CONSTRAINT hosts_name_check CHECK (octet_length(name) <= 128);
UPDATE hosts SET name='' WHERE (status='pending' AND public_key IS NULL AND name='待接入宿主') OR btrim(name, U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')='';
COMMIT;
