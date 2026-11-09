USE oportuna;

-- Optional offer classification for company catalog products; historical tenders remain untouched.
ALTER TABLE company_products
  ADD COLUMN tipos_comerciales JSON NULL AFTER exclusiones;
