export type ApiListing = {
  CodigoExterno?: string; Nombre?: string; CodigoEstado?: number | string;
  FechaCierre?: string; MontoEstimado?: number | string; Moneda?: string;
  Comprador?: { NombreOrganismo?: string };
  Fechas?: { FechaPublicacion?: string; FechaCreacion?: string; FechaCierre?: string };
  [key: string]: unknown;
};
export type StoredListing = {
  id: number; codigo_externo: string; nombre: string | null; codigo_estado: number | null;
  fecha_cierre: string | null; fecha_publicacion: string | null; organismo: string | null;
  monto_estimado: string | null; moneda: string | null; payload_json: ApiListing;
  last_synced_at: string;
};
