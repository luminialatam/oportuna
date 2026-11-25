import { useEffect, useState, type FormEvent } from 'react';
import {
  Building2,
  CheckCircle2,
  Info,
  LoaderCircle,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  ThumbsDown,
  X,
} from 'lucide-react';

type Profile = {
  nombreComercial: string;
  razonSocial: string;
  rut: string;
  emailContacto: string;
  telefono: string;
  direccion: string;
  comuna: string;
  regionPrincipal: string;
  descripcionComercial: string;
  actividad: string;
  rubros: string[];
  regiones: string[];
  sitioWeb: string;
  palabrasClave: string[];
  terminosExcluidos: string[];
  estados: number[];
};

type Product = {
  id?: number;
  nombre: string;
  categoria: string;
  descripcion: string;
  palabrasClave: string[];
  sinonimos: string[];
  terminosRelacionados: string[];
  aplicaciones: string[];
  exclusiones: string[];
  activo: boolean;
};

type Suggestions = {
  directSynonyms: string[];
  relatedTerms: string[];
  applications: string[];
  provider?: 'groq' | 'fallback';
};
type FieldErrors = Record<string, string>;

class RequestError extends Error {
  fieldErrors: FieldErrors;
  constructor(message: string, fieldErrors: unknown) {
    super(message);
    this.name = 'RequestError';
    this.fieldErrors = fieldErrors && typeof fieldErrors === 'object' ? fieldErrors as FieldErrors : {};
  }
}

const blankProfile: Profile = {
  nombreComercial: '',
  razonSocial: '',
  rut: '',
  emailContacto: '',
  telefono: '',
  direccion: '',
  comuna: '',
  regionPrincipal: '',
  descripcionComercial: '',
  actividad: '',
  rubros: [],
  regiones: [],
  sitioWeb: '',
  palabrasClave: [],
  terminosExcluidos: [],
  estados: [5],
};

const blankProduct: Product = {
  nombre: '',
  categoria: '',
  descripcion: '',
  palabrasClave: [],
  sinonimos: [],
  terminosRelacionados: [],
  aplicaciones: [],
  exclusiones: [],
  activo: true,
};

const listValue = (value: string) =>
  value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const profileListText = (value: string[] | null | undefined) => (value ?? []).join('\n');
const profileListValue = (value: string) =>
  value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

function formatRutForDisplay(value: string) {
  const compact = value.trim().toUpperCase().replace(/[.\-\s]/g, '');
  if (!/^\d{1,8}[0-9K]$/.test(compact)) return value;
  const body = compact.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${body}-${compact.slice(-1)}`;
}

async function request<T>(url: string, options?: RequestInit, csrfToken = ''): Promise<T> {
  const headers = new Headers(options?.headers);
  if (!['GET', 'HEAD', 'OPTIONS'].includes((options?.method ?? 'GET').toUpperCase()) && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken);
  }
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  const data = await response.json();
  if (!response.ok) throw new RequestError(data.error || 'No fue posible completar la solicitud.', data.fieldErrors);
  return data as T;
}

export function CompanyWorkspace({
  onSaved,
  csrfToken,
  canEdit = true,
  accessRole = 'admin',
}: {
  onSaved: () => void;
  csrfToken: string;
  canEdit?: boolean;
  accessRole?: 'admin' | 'collaborator' | 'read_only' | null;
}) {
  const [activeTab, setActiveTab] = useState<'profile' | 'catalog'>('profile');
  const [profile, setProfile] = useState<Profile>(blankProfile);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [profileListDraft, setProfileListDraft] = useState({
    rubros: '',
    regiones: '',
    palabrasClave: '',
    terminosExcluidos: '',
  });
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [product, setProduct] = useState<Product>(blankProduct);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [showProductForm, setShowProductForm] = useState(false);

  const load = async (search = '') => {
    setLoading(true);
    try {
      const [workspace, catalog] = await Promise.all([
        request<{ profile: Profile; products: Product[] }>('/api/company/profile'),
        request<{ items: Product[] }>(`/api/company/catalog?q=${encodeURIComponent(search)}`),
      ]);
      const loadedProfile = { ...blankProfile, ...workspace.profile };
      setProfile(loadedProfile);
      setProfileListDraft({
        rubros: profileListText(loadedProfile.rubros),
        regiones: profileListText(loadedProfile.regiones),
        palabrasClave: profileListText(loadedProfile.palabrasClave),
        terminosExcluidos: profileListText(loadedProfile.terminosExcluidos),
      });
      setProducts(catalog.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el perfil de empresa.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const updateProfile = <K extends keyof Profile>(key: K, value: Profile[K]) => {
    setProfile((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => { const next = { ...current }; delete next[key]; return next; });
  };
  const updateProfileListDraft = (key: keyof typeof profileListDraft, value: string) => {
    setProfileListDraft((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => { const next = { ...current }; delete next[key]; return next; });
  };
  const fieldError = (field: string) => fieldErrors[field] ? (
    <p id={`${field}-error`} role="alert" className="mt-1 text-[11px] text-red-700">{fieldErrors[field]}</p>
  ) : null;

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    setError('');
    setNotice('');
    setFieldErrors({});
    try {
      const saved = await request<{ profile: Profile }>(
        '/api/company/profile',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...profile,
            rubros: profileListValue(profileListDraft.rubros),
            regiones: profileListValue(profileListDraft.regiones),
            palabrasClave: profileListValue(profileListDraft.palabrasClave),
            terminosExcluidos: profileListValue(profileListDraft.terminosExcluidos),
          }),
        },
        csrfToken
      );
      const savedProfile = { ...blankProfile, ...saved.profile };
      setProfile(savedProfile);
      setProfileListDraft({
        rubros: profileListText(savedProfile.rubros),
        regiones: profileListText(savedProfile.regiones),
        palabrasClave: profileListText(savedProfile.palabrasClave),
        terminosExcluidos: profileListText(savedProfile.terminosExcluidos),
      });
      setNotice('Perfil de empresa actualizado con éxito.');
      onSaved();
      void load(query);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el perfil.');
      setFieldErrors(e instanceof RequestError ? e.fieldErrors : {});
    } finally {
      setBusy(false);
    }
  };

  const resetProduct = () => {
    setProduct(blankProduct);
    setEditingId(null);
    setSuggestions(null);
    setShowProductForm(false);
  };

  const setProductField = <K extends keyof Product>(key: K, value: Product[K]) =>
    setProduct((current) => ({ ...current, [key]: value }));

  const editProduct = (item: Product) => {
    setEditingId(item.id ?? null);
    setProduct({ ...item });
    setSuggestions(null);
    setShowProductForm(true);
  };

  const saveProduct = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const url = editingId ? `/api/company/catalog/${editingId}` : '/api/company/catalog';
      const saved = await request<{ items: Product[] }>(
        url,
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(product),
        },
        csrfToken
      );
      setProducts(saved.items);
      setNotice(editingId ? 'Producto actualizado.' : 'Producto agregado al catálogo.');
      resetProduct();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el producto.');
    } finally {
      setBusy(false);
    }
  };

  const deleteProduct = async (id: number) => {
    if (!window.confirm('¿Eliminar este producto o servicio del catálogo?')) return;
    setBusy(true);
    try {
      await request(`/api/company/catalog/${id}`, { method: 'DELETE' }, csrfToken);
      await load(query);
      setNotice('Producto eliminado del catálogo.');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar el producto.');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (item: Product) => {
    if (!item.id) return;
    setBusy(true);
    setError('');
    try {
      const saved = await request<{ items: Product[] }>(
        `/api/company/catalog/${item.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...item, activo: !item.activo }),
        },
        csrfToken
      );
      setProducts(saved.items);
      setNotice(
        item.activo ? 'Producto pausado del Match IA.' : 'Producto reactivado para el Match IA.'
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cambiar el estado del producto.');
    } finally {
      setBusy(false);
    }
  };

  const suggest = async () => {
    if (product.nombre.trim().length < 2) {
      setError('Ingresa el nombre del producto para pedir sugerencias de IA.');
      return;
    }
    setSuggesting(true);
    setError('');
    setSuggestions(null);
    try {
      setSuggestions(
        await request<Suggestions>(
          '/api/company/catalog/suggestions',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nombre: product.nombre,
              categoria: product.categoria || null,
              descripcion: product.descripcion || null,
            }),
          },
          csrfToken
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron generar sugerencias.');
    } finally {
      setSuggesting(false);
    }
  };

  const useSuggestion = (
    key: 'sinonimos' | 'terminosRelacionados' | 'aplicaciones',
    items: string[]
  ) =>
    setProduct((current) => ({
      ...current,
      [key]: [...new Set([...current[key], ...items])],
    }));

  return (
    <div className="space-y-6">
      {/* Top Heading */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold text-[#5636D9] uppercase tracking-wider mb-1">
            Configuración Comercial
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#171A24] tracking-tight">
            Mi Empresa y Catálogo
          </h1>
          <p className="text-sm text-[#5D6472] mt-1">
            Administra los datos de tu empresa y el catálogo de productos para potenciar el Match de
            oportunidades.
          </p>
        </div>

        {/* Tab switchers */}
        <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-[#E1E4EA] shadow-sm self-start sm:self-auto">
          <button
            onClick={() => setActiveTab('profile')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'profile'
                ? 'bg-[#5636D9] text-white shadow-sm'
                : 'text-[#5D6472] hover:bg-gray-100'
            }`}
          >
            <Building2 size={14} /> Perfil de Empresa
          </button>
          <button
            onClick={() => setActiveTab('catalog')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'catalog'
                ? 'bg-[#5636D9] text-white shadow-sm'
                : 'text-[#5D6472] hover:bg-gray-100'
            }`}
          >
            <Package size={14} /> Catálogo ({products.length})
          </button>
        </div>
      </div>

      {!canEdit && (
        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
          <Info size={15} />
          <span>
            {accessRole === 'read_only'
              ? 'Tienes permisos de solo lectura para esta empresa.'
              : 'Tu rol de colaborador permite ver datos pero no modificar el perfil ni el catálogo.'}{' '}
            Contacta a un administrador para solicitar cambios.
          </span>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')}>
            <X size={14} />
          </button>
        </div>
      )}

      {notice && (
        <div className="p-3.5 rounded-xl bg-[#f0edff] border border-[#5636D9]/30 text-xs text-[#5636D9] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={15} />
            <span>{notice}</span>
          </div>
          <button onClick={() => setNotice('')}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* TAB 1: PERFIL DE EMPRESA */}
      {activeTab === 'profile' && (
        <form onSubmit={saveProfile} className="space-y-6">
          <div className="bg-white rounded-xl border border-[#E1E4EA] p-6 shadow-sm space-y-5">
            <div className="border-b border-[#E1E4EA] pb-3">
              <h2 className="font-bold text-base text-[#171A24]">Datos Tributarios y Comerciales</h2>
              <p className="text-xs text-[#5D6472] mt-0.5">
                Información básica registrada para identificar a tu empresa ante Mercado Público.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
              <div>
                <label htmlFor="company-rut" className="block font-semibold text-[#5D6472] mb-1">RUT Empresa</label>
                <input
                  id="company-rut"
                  name="rut"
                  value={profile.rut}
                  disabled={!canEdit}
                  autoComplete="off"
                  inputMode="text"
                  spellCheck={false}
                  onChange={(e) => updateProfile('rut', e.target.value)}
                  onBlur={(e) => updateProfile('rut', formatRutForDisplay(e.target.value))}
                  aria-describedby={fieldErrors.rut ? 'company-rut-help rut-error' : 'company-rut-help'}
                  aria-invalid={Boolean(fieldErrors.rut)}
                  className="w-full h-10 px-3 rounded-lg border border-[#E1E4EA] font-mono font-bold text-[#171A24] focus:outline-none focus:border-[#5636D9] disabled:bg-[#F5F6F8]"
                />
                <p id="company-rut-help" className="mt-1 text-[11px] text-[#8A92A6]">Se valida al guardar y se usa para identificar a la empresa.</p>
                {fieldError('rut')}
              </div>
              <div>
                <label htmlFor="company-name" className="block font-semibold text-[#5D6472] mb-1">Nombre Comercial <span className="text-red-600">*</span></label>
                <input
                  id="company-name" name="nombreComercial"
                  value={profile.nombreComercial}
                  required
                  minLength={2}
                  maxLength={255}
                  disabled={!canEdit}
                  onChange={(e) => updateProfile('nombreComercial', e.target.value)}
                  aria-describedby={fieldErrors.nombreComercial ? 'nombreComercial-error' : undefined}
                  aria-invalid={Boolean(fieldErrors.nombreComercial)}
                  className="w-full h-10 px-3 rounded-lg border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
                {fieldError('nombreComercial')}
              </div>
              <div>
                <label htmlFor="company-legal-name" className="block font-semibold text-[#5D6472] mb-1">Razón Social</label>
                <input
                  id="company-legal-name" name="razonSocial"
                  value={profile.razonSocial}
                  maxLength={255}
                  disabled={!canEdit}
                  onChange={(e) => updateProfile('razonSocial', e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
                {fieldError('razonSocial')}
              </div>
              <div>
                <label htmlFor="company-email" className="block font-semibold text-[#5D6472] mb-1">Email de Contacto</label>
                <input
                  id="company-email" name="emailContacto"
                  type="email"
                  value={profile.emailContacto}
                  disabled={!canEdit}
                  onChange={(e) => updateProfile('emailContacto', e.target.value)}
                  aria-describedby={fieldErrors.emailContacto ? 'emailContacto-help emailContacto-error' : 'emailContacto-help'}
                  aria-invalid={Boolean(fieldErrors.emailContacto)}
                  className="w-full h-10 px-3 rounded-lg border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
                <p id="emailContacto-help" className="mt-1 text-[11px] text-[#8A92A6]">Opcional.</p>
                {fieldError('emailContacto')}
              </div>
              <div>
                <label htmlFor="company-phone" className="block font-semibold text-[#5D6472] mb-1">Teléfono</label>
                <input
                  id="company-phone" name="telefono"
                  value={profile.telefono}
                  disabled={!canEdit}
                  onChange={(e) => updateProfile('telefono', e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
                {fieldError('telefono')}
              </div>
              <div>
                <label htmlFor="company-website" className="block font-semibold text-[#5D6472] mb-1">Sitio Web</label>
                <input
                  id="company-website" name="sitioWeb"
                  type="url"
                  placeholder="https://"
                  value={profile.sitioWeb}
                  disabled={!canEdit}
                  onChange={(e) => updateProfile('sitioWeb', e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
                {fieldError('sitioWeb')}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs pt-2">
              <div>
                <label htmlFor="company-address" className="block font-semibold text-[#5D6472] mb-1">Dirección</label>
                <input
                  id="company-address" name="direccion"
                  value={profile.direccion}
                  disabled={!canEdit}
                  onChange={(e) => updateProfile('direccion', e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
                {fieldError('direccion')}
              </div>
              <div>
                <label htmlFor="company-commune" className="block font-semibold text-[#5D6472] mb-1">Comuna</label>
                <input
                  id="company-commune" name="comuna"
                  value={profile.comuna}
                  disabled={!canEdit}
                  onChange={(e) => updateProfile('comuna', e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
                {fieldError('comuna')}
              </div>
              <div>
                <label htmlFor="company-region" className="block font-semibold text-[#5D6472] mb-1">Región Principal</label>
                <input
                  id="company-region" name="regionPrincipal"
                  value={profile.regionPrincipal}
                  disabled={!canEdit}
                  onChange={(e) => updateProfile('regionPrincipal', e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
                {fieldError('regionPrincipal')}
              </div>
            </div>

            <div className="space-y-4 pt-3 border-t border-[#E1E4EA]">
              <div>
                  <label htmlFor="company-description" className="block text-xs font-semibold text-[#5D6472] mb-1">
                  Descripción comercial y actividades
                </label>
                <textarea
                  id="company-description" name="descripcionComercial"
                  rows={3}
                  value={profile.descripcionComercial || profile.actividad}
                  disabled={!canEdit}
                  onChange={(e) => {
                    updateProfile('actividad', e.target.value);
                    updateProfile('descripcionComercial', e.target.value);
                  }}
                  placeholder="Qué ofrece tu empresa, experiencia previa y tipo de soluciones que comercializa..."
                  className="w-full p-3 rounded-xl border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
                {fieldError('descripcionComercial')}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label htmlFor="company-industries" className="block font-semibold text-[#5D6472] mb-1">
                    Rubros comerciales (uno por línea)
                  </label>
                  <textarea
                    id="company-industries" name="rubros"
                    rows={3}
                    value={profileListDraft.rubros}
                    disabled={!canEdit}
                    aria-describedby={fieldErrors.rubros ? 'rubros-error' : undefined}
                    onChange={(e) => updateProfileListDraft('rubros', e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-[#E1E4EA] text-xs text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                  />
                  {fieldError('rubros')}
                </div>
                <div>
                  <label htmlFor="company-regions" className="block font-semibold text-[#5D6472] mb-1">
                    Regiones donde opera (una por línea)
                  </label>
                  <textarea
                    id="company-regions" name="regiones"
                    rows={3}
                    value={profileListDraft.regiones}
                    disabled={!canEdit}
                    aria-describedby={fieldErrors.regiones ? 'regiones-error' : undefined}
                    onChange={(e) => updateProfileListDraft('regiones', e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-[#E1E4EA] text-xs text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                  />
                  {fieldError('regiones')}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label htmlFor="company-keywords" className="block font-semibold text-[#5D6472] mb-1">
                    Palabras clave comerciales (una por línea)
                  </label>
                  <textarea
                    id="company-keywords" name="palabrasClave"
                    rows={3}
                    value={profileListDraft.palabrasClave}
                    disabled={!canEdit}
                    aria-describedby={fieldErrors.palabrasClave ? 'palabrasClave-error' : undefined}
                    onChange={(e) => updateProfileListDraft('palabrasClave', e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-[#E1E4EA] text-xs text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                  />
                  {fieldError('palabrasClave')}
                </div>
                <div>
                  <label htmlFor="company-excluded-terms" className="block font-semibold text-[#5D6472] mb-1">
                    Términos excluidos (uno por línea)
                  </label>
                  <textarea
                    id="company-excluded-terms" name="terminosExcluidos"
                    rows={3}
                    value={profileListDraft.terminosExcluidos}
                    disabled={!canEdit}
                    aria-describedby={fieldErrors.terminosExcluidos ? 'terminosExcluidos-error' : undefined}
                    onChange={(e) => updateProfileListDraft('terminosExcluidos', e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-[#E1E4EA] text-xs text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                  />
                  {fieldError('terminosExcluidos')}
                </div>
              </div>
            </div>

            {canEdit && (
              <div className="pt-4 border-t border-[#E1E4EA] flex items-center justify-between">
                <span className="text-xs text-[#8A92A6]">
                  Los cambios se aplican al cálculo de coincidencia comercial.
                </span>
                <button
                  type="submit"
                  disabled={busy}
                  className="h-10 px-5 bg-[#5636D9] hover:bg-[#4b2ec7] text-white text-xs font-semibold rounded-lg flex items-center gap-2 transition-colors shadow-sm"
                >
                  {busy ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}
                  Guardar Perfil
                </button>
              </div>
            )}
          </div>
        </form>
      )}

      {/* TAB 2: CATÁLOGO DE PRODUCTOS */}
      {activeTab === 'catalog' && (
        <div className="space-y-6">
          {/* Catalog Top Bar & Search */}
          <div className="bg-white rounded-xl border border-[#E1E4EA] p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search size={16} className="absolute left-3 top-3 text-[#8A92A6]" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar producto o servicio en catálogo..."
                className="w-full h-10 pl-9 pr-3 rounded-lg border border-[#E1E4EA] text-xs text-[#171A24] focus:outline-none focus:border-[#5636D9]"
              />
            </div>

            {canEdit && (
              <button
                onClick={() => {
                  resetProduct();
                  setShowProductForm(true);
                }}
                className="h-10 px-4 bg-[#5636D9] hover:bg-[#4b2ec7] text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors shadow-sm"
              >
                <Plus size={16} /> Agregar Producto / Servicio
              </button>
            )}
          </div>

          {/* New / Edit Product Form */}
          {showProductForm && canEdit && (
            <form
              onSubmit={saveProduct}
              className="bg-white rounded-xl border-2 border-[#5636D9]/30 p-6 shadow-md space-y-4"
            >
              <div className="flex items-center justify-between border-b border-[#E1E4EA] pb-3">
                <h3 className="font-bold text-sm text-[#171A24] flex items-center gap-2">
                  <PackagePlus size={18} className="text-[#5636D9]" />
                  {editingId ? 'Editar producto o servicio' : 'Nuevo producto o servicio'}
                </h3>
                <button
                  type="button"
                  onClick={resetProduct}
                  className="text-xs text-[#5D6472] hover:text-[#171A24]"
                >
                  Cancelar
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block font-semibold text-[#5D6472] mb-1">Nombre del producto *</label>
                  <input
                    required
                    value={product.nombre}
                    onChange={(e) => setProductField('nombre', e.target.value)}
                    placeholder="Ej. Ventilador mecánico de transporte"
                    className="w-full h-10 px-3 rounded-lg border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-[#5D6472] mb-1">Categoría</label>
                  <input
                    value={product.categoria}
                    onChange={(e) => setProductField('categoria', e.target.value)}
                    placeholder="Ej. Equipamiento Médico y Hospitalario"
                    className="w-full h-10 px-3 rounded-lg border border-[#E1E4EA] text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                  />
                </div>
              </div>

              <div className="text-xs">
                <label className="block font-semibold text-[#5D6472] mb-1">Descripción y usos comerciales</label>
                <textarea
                  rows={2}
                  value={product.descripcion}
                  onChange={(e) => setProductField('descripcion', e.target.value)}
                  placeholder="Especificaciones técnicas y ámbito de aplicación..."
                  className="w-full p-2.5 rounded-lg border border-[#E1E4EA] text-xs text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
              </div>

              <div className="text-xs">
                <label className="block font-semibold text-[#5D6472] mb-1">
                  Palabras clave y términos equivalentes (uno por línea)
                </label>
                <textarea
                  rows={2}
                  value={product.palabrasClave.join('\n')}
                  onChange={(e) => setProductField('palabrasClave', listValue(e.target.value))}
                  placeholder="autoclave, esterilización, vapor..."
                  className="w-full p-2.5 rounded-lg border border-[#E1E4EA] text-xs text-[#171A24] focus:outline-none focus:border-[#5636D9]"
                />
              </div>

              {/* Suggestions with IA */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  disabled={suggesting}
                  onClick={() => void suggest()}
                  className="h-9 px-3 bg-[#f0edff] hover:bg-[#e4ddff] text-[#5636D9] text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors self-start"
                >
                  <Sparkles size={14} />
                  {suggesting ? 'Generando sugerencias…' : 'Sugerir términos con IA'}
                </button>

                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <button
                    type="button"
                    onClick={resetProduct}
                    className="h-9 px-3 text-xs text-[#5D6472] hover:bg-gray-100 rounded-lg"
                  >
                    Descartar
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="h-9 px-4 bg-[#5636D9] hover:bg-[#4b2ec7] text-white text-xs font-semibold rounded-lg shadow-sm"
                  >
                    {editingId ? 'Actualizar Producto' : 'Guardar en Catálogo'}
                  </button>
                </div>
              </div>

              {suggestions && (
                <div className="p-3.5 rounded-xl bg-[#F8F9FA] border border-[#E1E4EA] space-y-2 text-xs">
                  <span className="font-bold text-[#171A24] flex items-center gap-1">
                    <Sparkles size={13} className="text-[#5636D9]" />
                    Sugerencias generadas para revisar (haz clic para agregar):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      ...suggestions.directSynonyms,
                      ...suggestions.relatedTerms,
                      ...suggestions.applications,
                    ].map((term) => (
                      <button
                        key={term}
                        type="button"
                        onClick={() => useSuggestion('sinonimos', [term])}
                        className="px-2 py-0.5 rounded-full bg-white border border-[#E1E4EA] hover:border-[#5636D9] text-[#5D6472] hover:text-[#5636D9] text-[11px]"
                      >
                        + {term}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </form>
          )}

          {/* Products List */}
          {loading ? (
            <div className="p-12 text-center text-sm text-[#5D6472] bg-white rounded-xl border border-[#E1E4EA]">
              <LoaderCircle size={24} className="spin mx-auto text-[#5636D9] mb-2" />
              Cargando catálogo de productos…
            </div>
          ) : products.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-xl border border-[#E1E4EA] space-y-3">
              <Package size={24} className="mx-auto text-[#8A92A6]" />
              <h3 className="font-bold text-base text-[#171A24]">El catálogo está vacío</h3>
              <p className="text-xs text-[#5D6472] max-w-sm mx-auto">
                Registra tus productos o servicios para que el motor de coincidencia pueda encontrar
                licitaciones afines.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {products.map((item) => (
                <div
                  key={item.id}
                  className="bg-white rounded-xl border border-[#E1E4EA] p-5 shadow-sm space-y-3 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-bold text-sm text-[#171A24]">{item.nombre}</h4>
                        {item.categoria && (
                          <span className="text-[11px] text-[#5D6472] block mt-0.5">
                            {item.categoria}
                          </span>
                        )}
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                          item.activo
                            ? 'bg-[#f0edff] text-[#5636D9]'
                            : 'bg-gray-100 text-[#5D6472]'
                        }`}
                      >
                        {item.activo ? 'Activo en Match' : 'Pausado'}
                      </span>
                    </div>

                    {item.descripcion && (
                      <p className="text-xs text-[#5D6472] line-clamp-2">{item.descripcion}</p>
                    )}

                    {/* Keywords pills */}
                    {item.palabrasClave?.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {item.palabrasClave.slice(0, 4).map((kw) => (
                          <span
                            key={kw}
                            className="text-[10px] px-2 py-0.5 rounded-md bg-[#F5F6F8] text-[#5D6472]"
                          >
                            {kw}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {canEdit && (
                    <div className="pt-3 border-t border-[#E1E4EA] flex items-center justify-between text-xs">
                      <button
                        onClick={() => void toggleActive(item)}
                        className="text-xs text-[#5D6472] hover:text-[#171A24] font-medium"
                      >
                        {item.activo ? 'Pausar Match' : 'Activar Match'}
                      </button>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => editProduct(item)}
                          className="p-1.5 rounded-lg text-[#5D6472] hover:bg-gray-100 hover:text-[#171A24]"
                          title="Editar producto"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => item.id && void deleteProduct(item.id)}
                          className="p-1.5 rounded-lg text-[#5D6472] hover:bg-red-50 hover:text-red-600"
                          title="Eliminar producto"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MatchLoadingSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-label="Buscando oportunidades relacionadas con tu empresa" className="space-y-3 py-2">
      <span className="sr-only">Buscando oportunidades relacionadas con los productos y palabras clave de tu empresa…</span>
      <div className="flex items-center gap-2 text-xs font-medium text-[#5D6472]">
        <span className="inline-flex h-2 w-2 rounded-full bg-[#5636D9] animate-pulse" />
        Buscando oportunidades relacionadas con tu empresa…
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 animate-pulse">
        {['Coincidencias','Alta','Media','Próximos cierres'].map((label) => (
          <div key={label} className="rounded-lg border border-[#E1E4EA] bg-[#F8F9FB] p-3 space-y-2">
            <div className="h-3 w-20 rounded bg-[#E1E4EA]" />
            <div className="h-5 w-10 rounded bg-[#D9D3F8]" />
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border border-[#E1E4EA]">
        {[0, 1, 2].map((row) => (
          <div key={row} className="grid grid-cols-[minmax(0,2fr)_1fr_0.8fr] gap-4 border-b last:border-b-0 border-[#E1E4EA] p-3 animate-pulse">
            <div className="space-y-2"><div className="h-3 w-4/5 rounded bg-[#E1E4EA]" /><div className="h-3 w-2/5 rounded bg-[#ECEEF2]" /></div>
            <div className="h-3 w-3/4 rounded bg-[#ECEEF2] self-center" />
            <div className="h-3 w-2/3 rounded bg-[#ECEEF2] self-center" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function CompanyOpportunities({
  onConfigure,
  onOpenListing,
  onViewAll,
  actionLabel = 'Ver ficha',
  viewAllLabel = 'Ver oportunidades',
  board = false,
  csrfToken,
}: {
  onConfigure: () => void;
  onOpenListing?: (code: string) => void;
  onViewAll?: () => void;
  actionLabel?: string;
  viewAllLabel?: string;
  board?: boolean;
  csrfToken: string;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [dismissingCode, setDismissingCode] = useState('');
  const [actionNotice, setActionNotice] = useState('');

  const dismissMatch = async (code: string) => {
    setDismissingCode(code);
    setActionNotice('');
    setError('');
    try {
      await request('/api/company/matches/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: code }),
      }, csrfToken);
      setActionNotice(`Descartaste ${code}. Buscando la siguiente coincidencia para tu empresa…`);
      setReloadKey((key) => key + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo descartar esta coincidencia.');
    } finally {
      setDismissingCode('');
    }
  };

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    setLoading(true);
    setError('');
    request<any>(board ? '/api/company/matches?view=board' : '/api/company/matches', { signal: controller.signal })
      .then((val) => {
        if (live) setData(val);
      })
      .catch((e) => {
        if (!live) return;
        setError(e?.name === 'AbortError'
          ? 'La búsqueda está tardando más de lo esperado. Puedes volver a intentarlo.'
          : e instanceof Error ? e.message : 'No se pudieron cargar las oportunidades. Puedes volver a intentarlo.');
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [board, reloadKey]);

  return (
    <section className="summary-matches-panel bg-white rounded-xl border border-[#E1E4EA] p-5 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E1E4EA] pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-sm text-[#171A24] flex items-center gap-2">
              <Sparkles size={16} className="text-[#5636D9]" />
              Mejores coincidencias para tu empresa
            </h3>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#f0edff] text-[#5636D9] whitespace-nowrap">
              Match personalizado
            </span>
          </div>
          <p className="text-xs text-[#5D6472] mt-0.5">
            Oportuna cruza las licitaciones activas del índice local con tus productos y palabras clave comerciales. El puntaje de 0 a 100 mide evidencia textual; no predice una adjudicación.
          </p>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <button onClick={onConfigure} className="text-xs font-semibold text-[#5636D9] hover:underline self-start sm:self-auto">
            Configurar catálogo
          </button>
          {onViewAll && (
            <button onClick={onViewAll} className="text-xs font-semibold text-[#5636D9] hover:underline inline-flex items-center gap-1">
              {viewAllLabel} <Search size={13} />
            </button>
          )}
        </div>
      </div>

      {actionNotice && <p role="status" aria-live="polite" className="rounded-lg border border-[#DED8FF] bg-[#FAF9FF] px-3 py-2 text-xs text-[#5636D9]">{actionNotice}</p>}
      {loading ? (
        <MatchLoadingSkeleton />
      ) : error ? (
        <div role="alert" className="py-4 flex items-center justify-between gap-3 text-xs text-red-600">
          <span>{error}</span>
          <button onClick={() => setReloadKey((key) => key + 1)} className="shrink-0 rounded-lg border border-[#E1E4EA] px-3 py-2 font-semibold text-[#5636D9] hover:bg-[#f0edff]">Reintentar</button>
        </div>
      ) : !data?.configured ? (
        <div className="summary-match-empty py-8 text-center text-xs text-[#5D6472] space-y-2">
          <Sparkles size={20} className="mx-auto text-[#8A92A6]" />
          <p>Configura productos en tu catálogo para calcular coincidencias con oportunidades indexadas.</p>
          <button
            onClick={onConfigure}
            className="px-4 py-2 bg-[#5636D9] text-white rounded-lg text-xs font-semibold"
          >
            Registrar productos
          </button>
        </div>
      ) : (
        <>
          <p className="text-xs text-[#5D6472]">
            {data.matchingBasis === 'profile_keywords'
              ? `Coincidencia automática usando ${Number(data.profileKeywordCount || 0)} palabras clave guardadas en Mi empresa. Se revisan hasta ${Number(data.candidatesEvaluated || 0).toLocaleString('es-CL')} fichas candidatas, priorizadas por fecha de cierre.`
              : `Coincidencia automática usando los productos activos de tu catálogo y el perfil comercial. Se revisan hasta ${Number(data.candidatesEvaluated || 0).toLocaleString('es-CL')} fichas candidatas, priorizadas por fecha de cierre.`}
          </p>
          <div className="summary-match-metrics grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div><span>Coincidencias</span><b>{Number(data.total || 0).toLocaleString('es-CL')}</b></div>
            <div><span>Alta</span><b>{Number(data.high || 0).toLocaleString('es-CL')}</b></div>
            <div><span>Media</span><b>{Number(data.medium || 0).toLocaleString('es-CL')}</b></div>
            <div><span>Cierran en 14 días</span><b>{Number(data.closingSoon || 0).toLocaleString('es-CL')}</b></div>
          </div>
          {data.items?.length ? (
            <div className="summary-matches-table-wrap">
              <table className="summary-matches-table">
                <thead><tr><th>Licitación</th><th>Comprador</th><th>Cierre</th><th>Monto estimado</th><th>Puntaje / 100</th><th>Acción</th></tr></thead>
                <tbody>
                  {data.items.map((item: any) => {
                    const closing = item.fecha_cierre ? new Date(item.fecha_cierre) : null;
                    const closingLabel = closing && Number.isFinite(closing.getTime())
                      ? new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).format(closing)
                      : 'No informado';
                    const amount = item.monto_estimado == null || item.monto_estimado === ''
                      ? 'No informado'
                      : new Intl.NumberFormat('es-CL', { style: 'currency', currency: item.moneda || 'CLP', maximumFractionDigits: 0 }).format(Number(item.monto_estimado));
                    return (
                      <tr key={item.codigo_externo}>
                        <td>
                          <b className="summary-match-title">{item.nombre || 'Nombre no disponible'}</b>
                          <small>{item.codigo_externo}{item.productName ? ` · Coincide con ${item.productName}` : ''}</small>
                        </td>
                        <td><span className="summary-match-buyer">{item.organismo || 'No informado'}</span></td>
                        <td className="summary-match-nowrap">{closingLabel}</td>
                        <td className="summary-match-amount">{amount}</td>
                        <td><span className="summary-match-score">{Number(item.score || 0)} / 100</span></td>
                        <td>
                          <div className="summary-match-actions">
                            {onOpenListing ? (
                              <button
                                type="button"
                                className="summary-match-action"
                                onClick={() => onOpenListing(item.codigo_externo)}
                                aria-label={`${actionLabel}: ${item.nombre || item.codigo_externo}`}
                                title={actionLabel}
                              >
                                <Search size={16} aria-hidden="true" />
                                <span className="sr-only">{actionLabel}</span>
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="summary-match-dismiss"
                              disabled={Boolean(dismissingCode)}
                              onClick={() => void dismissMatch(item.codigo_externo)}
                              aria-label={`Descartar ${item.nombre || item.codigo_externo} y mostrar la siguiente coincidencia`}
                              title="Descartar y ver la siguiente"
                            >
                              {dismissingCode === item.codigo_externo ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <ThumbsDown size={16} aria-hidden="true" />}
                              <span className="sr-only">{dismissingCode === item.codigo_externo ? 'Actualizando coincidencias' : 'No me sirve; descartar y ver la siguiente'}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="summary-match-empty py-8 text-center text-xs text-[#5D6472]">
              No hay coincidencias en las licitaciones activas del índice local para los criterios comerciales guardados. La búsqueda evaluó {Number(data.candidatesEvaluated || 0).toLocaleString('es-CL')} licitaciones.
            </div>
          )}
          {board && data.total > data.items?.length && (
            <p className="text-xs text-[#5D6472]">Mostrando las {data.items.length} coincidencias con mayor relevancia de {data.total} encontradas.</p>
          )}
          {data.disclaimer && <p className="summary-match-disclaimer">{data.disclaimer}</p>}
        </>
      )}
    </section>
  );
}
