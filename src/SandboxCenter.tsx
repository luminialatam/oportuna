import { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Database,
  FlaskConical,
  KeyRound,
  RotateCcw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  XCircle,
} from 'lucide-react';

interface SandboxCenterProps {
  onBackToApp: () => void;
}

export function SandboxCenter({ onBackToApp }: SandboxCenterProps) {
  const [selectedHttpCode, setSelectedHttpCode] = useState<number>(200);
  const [simulatedRut, setSimulatedRut] = useState('76.842.109-9');
  const [rutValidationStatus, setRutValidationStatus] = useState<
    'idle' | 'valid' | 'invalid'
  >('idle');
  const [invitationState, setInvitationState] = useState<
    'valid' | 'expired' | 'used'
  >('valid');
  const [auditLog, setAuditLog] = useState<string[]>([
    'Iniciado Sandbox de Pruebas Oportuna v1.0',
    'Simulación aislada: las mutaciones no impactan la base de datos MySQL real.',
  ]);

  const addLog = (msg: string) => {
    const time = new Intl.DateTimeFormat('es-CL', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date());
    setAuditLog((prev) => [`[${time}] ${msg}`, ...prev.slice(0, 8)]);
  };

  const handleTestHttpStatus = (code: number) => {
    setSelectedHttpCode(code);
    addLog(`Simulando respuesta HTTP ${code}`);
  };

  const handleValidateRut = () => {
    const clean = simulatedRut.replace(/[^0-9kK]/g, '').toUpperCase();
    if (clean.length < 2) {
      setRutValidationStatus('invalid');
      addLog(`RUT ${simulatedRut} formato inválido`);
      return;
    }
    const cuerpo = clean.slice(0, -1);
    const dv = clean.slice(-1);
    let suma = 0;
    let multiplo = 2;
    for (let i = cuerpo.length - 1; i >= 0; i--) {
      suma += multiplo * parseInt(cuerpo.charAt(i), 10);
      multiplo = multiplo < 7 ? multiplo + 1 : 2;
    }
    const dvEsperado = 11 - (suma % 11);
    const dvCalculado =
      dvEsperado === 11 ? '0' : dvEsperado === 10 ? 'K' : String(dvEsperado);

    if (dvCalculado === dv) {
      setRutValidationStatus('valid');
      addLog(`RUT ${simulatedRut} verificado con éxito (módulo 11)`);
    } else {
      setRutValidationStatus('invalid');
      addLog(`RUT ${simulatedRut} falló dígito verificador`);
    }
  };

  const handleReset = () => {
    setSelectedHttpCode(200);
    setSimulatedRut('76.842.109-9');
    setRutValidationStatus('idle');
    setInvitationState('valid');
    setAuditLog([
      'Centro de pruebas restablecido a valores iniciales.',
      'Sin conexiones a entornos productivos.',
    ]);
  };

  return (
    <div className="space-y-6">
      {/* Isolation Banner */}
      <div className="relative overflow-hidden rounded-xl bg-[#171A24] text-white p-6 sm:p-8 shadow-xl border border-gray-800">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-3 max-w-2xl">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-950/80 border border-red-800 text-red-300 text-xs uppercase tracking-wider font-bold">
                <ShieldAlert className="w-3.5 h-3.5" />
                Entorno aislado · Solo Demostración
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-800/80 text-gray-300 text-xs">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                Sin conexión productiva ni escritura en bases de datos reales
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2">
              <FlaskConical className="text-[#5636D9]" />
              Centro de Pruebas del Prototipo
            </h1>
            <p className="text-gray-300 text-sm sm:text-base">
              Simula respuestas del servidor, errores de validación y estados de
              invitación sin alterar las pantallas oficiales ni las bases de
              datos de Mercado Público.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
            <button
              onClick={handleReset}
              className="h-10 px-4 rounded-lg bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors border border-gray-700"
            >
              <RotateCcw className="w-4 h-4" />
              Restablecer Todo
            </button>
            <button
              onClick={onBackToApp}
              className="h-10 px-4 rounded-lg bg-[#5636D9] hover:bg-[#4b2ec7] text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors shadow-md"
            >
              <ArrowLeft className="w-4 h-4" />
              Volver a la Aplicación
            </button>
          </div>
        </div>
      </div>

      {/* Specimen Entity & Sandbox Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white rounded-xl border border-[#E1E4EA] p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-bold text-[#5D6472] tracking-wider">
              Entidad de Prueba
            </span>
            <ShieldCheck className="w-4 h-4 text-[#5636D9]" />
          </div>
          <div>
            <h3 className="font-bold text-lg text-[#171A24]">
              Constructora Andes SpA
            </h3>
            <p className="text-xs text-[#5D6472]">
              RUT: <span className="font-semibold">76.842.109-9</span>
            </p>
            <p className="text-xs text-[#5D6472]">Rubro: Obras Civiles</p>
          </div>
          <div className="pt-2 border-t border-[#E1E4EA]">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#5636D9] bg-[#f0edff] px-2 py-0.5 rounded-full">
              Perfil Simulado Verificado
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#E1E4EA] p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-bold text-[#5D6472] tracking-wider">
              Criptografía y Auditoría
            </span>
            <KeyRound className="w-4 h-4 text-[#5636D9]" />
          </div>
          <p className="text-xs text-[#5D6472]">
            Las contraseñas utilizan Argon2id y los tokens de sesión utilizan SHA-256 en el
            backend real. Este sandbox verifica la tolerancia a tokens simulados, expirados
            o inválidos sin escribir en la base de datos.
          </p>
          <div className="p-2.5 rounded bg-[#F5F6F8] border border-[#E1E4EA] text-[11px] font-mono text-[#171A24]">
            TOKEN_PREVIEW: opt_demo_e7a83c21...
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#E1E4EA] p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-bold text-[#5D6472] tracking-wider">
              Modo de Operación
            </span>
            <Database className="w-4 h-4 text-amber-600" />
          </div>
          <div className="space-y-1">
            <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
              Mock Interactivo Local
            </span>
            <p className="text-xs text-[#5D6472]">
              Permite validar el comportamiento de la interfaz gráfica ante
              fallos sin comprometer la base de datos MySQL de Oportuna.
            </p>
          </div>
        </div>
      </div>

      {/* Simulation Controls Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Simulator 1: HTTP Responses */}
        <div className="bg-white rounded-xl border border-[#E1E4EA] p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-base text-[#171A24] flex items-center gap-2">
              <Terminal className="w-5 h-5 text-[#5636D9]" />
              Simulador de Respuestas HTTP
            </h2>
            <span className="text-xs text-[#5D6472]">Estado seleccionado:</span>
          </div>
          <p className="text-xs text-[#5D6472]">
            Haz clic en los botones para probar el comportamiento de los
            componentes ante diferentes códigos de estado:
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              { code: 200, label: '200 OK', color: 'border-[#5636D9] text-[#5636D9] hover:bg-[#f0edff]' },
              { code: 400, label: '400 Bad Req', color: 'border-amber-500 text-amber-600 hover:bg-amber-50' },
              { code: 401, label: '401 Unauth', color: 'border-red-500 text-red-600 hover:bg-red-50' },
              { code: 403, label: '403 Forbid', color: 'border-red-600 text-red-700 hover:bg-red-50' },
              { code: 500, label: '500 Server', color: 'border-purple-600 text-purple-700 hover:bg-purple-50' },
            ].map((item) => (
              <button
                key={item.code}
                onClick={() => handleTestHttpStatus(item.code)}
                className={`py-2 px-3 text-xs font-bold rounded-lg border transition-all ${item.color} ${
                  selectedHttpCode === item.code ? 'ring-2 ring-offset-1 ring-[#5636D9]' : ''
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="p-3 rounded-lg bg-[#F5F6F8] border border-[#E1E4EA] text-xs space-y-1">
            <div className="font-semibold text-[#171A24]">
              Resultado de simulación HTTP {selectedHttpCode}:
            </div>
            <div className="text-[#5D6472]">
              {selectedHttpCode === 200 && 'Respuesta exitosa normal. Los datos se entregan correctamente.'}
              {selectedHttpCode === 400 && 'Error de validación en parámetros de consulta o cuerpo JSON.'}
              {selectedHttpCode === 401 && 'Sesión no autenticada o token CSRF expirado. Redirigiría al acceso.'}
              {selectedHttpCode === 403 && 'Acceso denegado: el rol requiere privilegios de Administrador de empresa.'}
              {selectedHttpCode === 500 && 'Falla en el servicio upstream de Mercado Público o error de conexión.'}
            </div>
          </div>
        </div>

        {/* Simulator 2: RUT Formatter & Módulo 11 */}
        <div className="bg-white rounded-xl border border-[#E1E4EA] p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-base text-[#171A24] flex items-center gap-2">
              <Shield className="w-5 h-5 text-[#5636D9]" />
              Validador de RUT Chileno (Módulo 11)
            </h2>
            <span className="text-xs text-[#5D6472]">Algoritmo oficial</span>
          </div>
          <p className="text-xs text-[#5D6472]">
            Verifica el algoritmo de validación de RUT utilizado en registro y
            perfil de empresa:
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={simulatedRut}
              onChange={(e) => {
                setSimulatedRut(e.target.value);
                setRutValidationStatus('idle');
              }}
              placeholder="Ej: 76.842.109-9"
              className="flex-1 h-10 px-3 border border-[#E1E4EA] rounded-lg text-sm text-[#171A24] focus:outline-none focus:border-[#5636D9]"
            />
            <button
              onClick={handleValidateRut}
              className="h-10 px-4 bg-[#5636D9] hover:bg-[#4b2ec7] text-white text-xs font-semibold rounded-lg transition-colors"
            >
              Validar RUT
            </button>
          </div>

          {rutValidationStatus !== 'idle' && (
            <div
              className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
                rutValidationStatus === 'valid'
                  ? 'bg-[#f0edff] border-[#5636D9]/30 text-[#5636D9]'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              {rutValidationStatus === 'valid' ? (
                <>
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>RUT válido conforme al algoritmo oficial del Servicio de Impuestos Internos.</span>
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 shrink-0" />
                  <span>RUT inválido. El dígito verificador no coincide con la serie ingresada.</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Simulator 3: Invitation Token States */}
        <div className="bg-white rounded-xl border border-[#E1E4EA] p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-base text-[#171A24] flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-[#5636D9]" />
              Estados de Invitación de Equipo
            </h2>
            <span className="text-xs text-[#5D6472]">Token de 1 solo uso</span>
          </div>
          <p className="text-xs text-[#5D6472]">
            Simula las respuestas al canjear tokens de invitación recibidos:
          </p>
          <div className="flex items-center gap-2">
            {[
              { id: 'valid', label: 'Invitación Válida' },
              { id: 'expired', label: 'Invitación Expirada' },
              { id: 'used', label: 'Ya Canjeada' },
            ].map((st) => (
              <button
                key={st.id}
                onClick={() => {
                  setInvitationState(st.id as any);
                  addLog(`Simulado canje de invitación en estado: ${st.label}`);
                }}
                className={`py-2 px-3 text-xs font-semibold rounded-lg border transition-all ${
                  invitationState === st.id
                    ? 'bg-[#5636D9] text-white border-[#5636D9]'
                    : 'bg-white text-[#5D6472] border-[#E1E4EA] hover:bg-gray-50'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>
          <div className="p-3 rounded-lg bg-[#F5F6F8] border border-[#E1E4EA] text-xs">
            {invitationState === 'valid' && (
              <span className="text-[#5636D9] font-medium flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Permite registro o asignación inmediata a la empresa.
              </span>
            )}
            {invitationState === 'expired' && (
              <span className="text-amber-700 font-medium flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Token expirado (más de 7 días). Se requiere solicitar un nuevo enlace al Administrador.
              </span>
            )}
            {invitationState === 'used' && (
              <span className="text-red-700 font-medium flex items-center gap-1.5">
                <XCircle className="w-3.5 h-3.5" />
                El token ya fue utilizado por otro usuario y quedó invalidado.
              </span>
            )}
          </div>
        </div>

        {/* Live Test Console Log */}
        <div className="bg-white rounded-xl border border-[#E1E4EA] p-6 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-base text-[#171A24] flex items-center gap-2">
              <Terminal className="w-5 h-5 text-gray-700" />
              Consola de Actividad del Sandbox
            </h2>
            <button
              onClick={() => setAuditLog(['Consola reiniciada.'])}
              className="text-xs text-[#5636D9] hover:underline"
            >
              Limpiar
            </button>
          </div>
          <div className="bg-[#171A24] rounded-lg p-3 font-mono text-xs text-gray-300 min-h-[140px] max-h-[160px] overflow-y-auto space-y-1">
            {auditLog.map((log, idx) => (
              <div key={idx} className="leading-relaxed">
                {log}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
