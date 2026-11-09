USE oportuna;
ALTER TABLE licitaciones ADD FULLTEXT INDEX ft_licitaciones_busqueda (nombre, organismo);
CREATE INDEX idx_licitaciones_cierre_estado ON licitaciones (fecha_cierre, codigo_estado);
