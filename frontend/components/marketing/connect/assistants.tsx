import Link from "next/link";
import { KeyRound, ShieldCheck } from "lucide-react";
import { connectorScopeLabel } from "@/lib/account";
import { CopyUrl } from "./CopyUrl";
import { FirstQuestion } from "./KindBlocks";
import { Shot, type ShotData } from "./Lightbox";

/*
 * El paso a paso por asistente. Sumar uno es sumar un elemento a ASSISTANTS,
 * y sólo después de probarlo de punta a punta (alta del conector → login →
 * una respuesta con datos): el conector exige OAuth 2.1 con registro dinámico
 * e indicador `resource`, y no todos los asistentes lo implementan igual.
 *
 * Probados: Claude en la web y en la app de escritorio (OAuth) y Claude Code
 * (token personal). Las capturas de Claude son de la sesión del usuario,
 * recortadas y sin datos personales; las de RegistrApp, de una cuenta de demo.
 */

/** settings.MCP_RESOURCE_URL de producción, la misma que muestra Configuración. */
export const CONNECTOR_URL = "https://registrapp-api.imanzanastore.com.ar/mcp";

const SCOPE_HOUSEHOLD = connectorScopeLabel({ tenant_kind: "household", role: "admin" } as Parameters<typeof connectorScopeLabel>[0]);
const SCOPE_BUSINESS = connectorScopeLabel({ tenant_kind: "business", role: "admin" } as Parameters<typeof connectorScopeLabel>[0]);

/** El texto literal de un botón o menú del asistente o de la app. */
function Ui({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-md border border-ink/20 bg-accent px-1.5 py-0.5 font-sans text-[0.92em] font-semibold text-foreground whitespace-nowrap">
      {children}
    </code>
  );
}

function Callout({ icon: Icon = ShieldCheck, children }: { icon?: typeof ShieldCheck; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl border-2 border-emerald-700/30 bg-emerald-50 p-4 text-[15px] md:text-base text-foreground">
      <Icon className="w-5 h-5 mt-0.5 text-emerald-700 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

const shot = (src: string, width: number, height: number, alt: string): ShotData => ({ src, width, height, alt });
const S = {
  menu: shot("/conectar/claude/1-menu-conectores.webp", 1400, 570,
    "Claude: el + del cuadro de mensaje abierto en Conectores, con Agregar conector y Agregar conector personalizado"),
  formEmpty: shot("/conectar/claude/2-formulario-vacio.webp", 1070, 869,
    "Claude: la ventana Agregar conector personalizado, con los campos de nombre y dirección vacíos"),
  formFull: shot("/conectar/claude/3-formulario-completo.webp", 1070, 869,
    "Claude: la ventana Agregar conector personalizado con el nombre Registrapp y la dirección del conector pegada"),
  authorize: shot("/conectar/autorizar.webp", 960, 962,
    "RegistrApp: la página para autorizar a Claude, con lo que va a poder leer y cargar, y los botones Autorizar y Cancelar"),
  list: shot("/conectar/claude/4-conectores-lista.webp", 1400, 434,
    "Claude: Configuración, Conectores, pestaña Tuyos, con Registrapp marcado como Personalizado y conectado"),
  detail: shot("/conectar/claude/5-conector-detalle.webp", 1400, 876,
    "Claude: el detalle del conector Registrapp, con Desconectar y los permisos de cada herramienta"),
  token: shot("/conectar/token.webp", 1520, 660,
    "RegistrApp: Configuración, Conectar con una IA, un token recién creado con los botones Copiar token y Ya lo guardé"),
};

export interface StepData { title: string; body: React.ReactNode }
export interface Assistant { id: string; label: string; intro: React.ReactNode; steps: StepData[] }

const COMMAND = `claude mcp add --transport http registrapp ${CONNECTOR_URL} --header "Authorization: Bearer rap_pat_…"`;

export const ASSISTANTS: Assistant[] = [
  {
    id: "claude",
    label: "Claude (web y escritorio)",
    intro: <>Los pasos son los mismos en <strong className="text-foreground">claude.ai</strong> y en la app de escritorio de Claude.</>,
    steps: [
      { title: "Abrí los conectores", body: <>
        <p>
          En un chat nuevo, tocá el <Ui>+</Ui> del cuadro de mensaje → <Ui>Conectores</Ui> → <Ui>Agregar conector</Ui> → <Ui>Agregar conector personalizado</Ui>.
        </p>
        <Shot shot={S.menu} />
        <p className="text-[15px]">
          También podés entrar por <Ui>Configuración</Ui> → <Ui>Conectores</Ui> → <Ui>+ Agregar</Ui>.
        </p>
      </> },
      { title: "Se abre el formulario", body: <>
        <p>
          Tiene dos campos: el nombre con el que lo vas a ver en la lista de conectores y la dirección del servidor.
        </p>
        <Shot shot={S.formEmpty} maxWidth={535} />
      </> },
      { title: "Pegá la dirección y tocá Continuar", body: <>
        <p>En el nombre poné <Ui>RegistrApp</Ui> y, en la dirección, pegá esta:</p>
        <CopyUrl value={CONNECTOR_URL} label="Dirección del conector" />
        <p>Después tocá <Ui>Continuar</Ui>.</p>
        <Shot shot={S.formFull} maxWidth={535} />
      </> },
      { title: "Iniciá sesión y autorizá", body: <>
        <p>
          Claude abre la página de RegistrApp. Entrá con tu cuenta de Google, revisá lo que va a poder hacer y tocá <Ui>Autorizar</Ui>.
          En un hogar dice <strong className="text-foreground">«{SCOPE_HOUSEHOLD}»</strong>; en un negocio, <strong className="text-foreground">«{SCOPE_BUSINESS}»</strong>.
        </p>
        <Shot shot={S.authorize} maxWidth={420} />
        <Callout>
          Iniciás sesión en la página de RegistrApp, no en Claude. Claude recibe un permiso para usar tu cuenta,
          que podés cortar cuando quieras; tu contraseña nunca pasa por la IA.
        </Callout>
      </> },
      { title: "Listo: ya está conectado", body: <>
        <p>
          Volvés a Claude. En <Ui>Configuración</Ui> → <Ui>Conectores</Ui>, pestaña <Ui>Tuyos</Ui>, RegistrApp aparece como <Ui>Personalizado</Ui>, con la tilde de conectado.
        </p>
        <Shot shot={S.list} />
      </> },
      { title: "Elegí qué puede hacer solo", body: <>
        <p>
          Tocá el conector para ver su detalle. En <Ui>Permisos de herramientas</Ui> elegís, para cada una, si Claude la usa sin preguntarte,
          si te pide permiso antes o si queda bloqueada. Ahí también está <Ui>Desconectar</Ui>.
        </p>
        <Shot shot={S.detail} />
      </> },
      { title: "Preguntale", body: <FirstQuestion /> },
    ],
  },
  {
    id: "claude-code",
    label: "Claude Code",
    intro: <>Claude Code se conecta con un <strong className="text-foreground">token personal</strong> que creás en RegistrApp, en vez de iniciar sesión.</>,
    steps: [
      { title: "Creá un token en RegistrApp", body: <>
        <p>
          Entrá a <Link href="/settings" className="font-semibold text-primary hover:underline">Configuración</Link> → <Ui>Conectar con una IA</Ui>.
          En <Ui>Token</Ui>, tocá <Ui>Crear token</Ui>, ponele un nombre (por ejemplo «Claude Code»), elegí cuándo vence y tocá <Ui>Crear</Ui>.
        </p>
      </> },
      { title: "Copialo ahora", body: <>
        <p>El token se muestra una sola vez. Tocá <Ui>Copiar token</Ui> y tenelo a mano para el paso siguiente.</p>
        <Shot shot={S.token} />
        <Callout icon={KeyRound}>
          El token es una llave a tu cuenta: no lo pegues en un chat ni lo subas a un repositorio. Si se te escapa,
          borralo desde la misma lista con el tacho y creá otro.
        </Callout>
      </> },
      { title: "Agregá el conector en la terminal", body: <>
        <p>Pegá este comando y reemplazá <Ui>rap_pat_…</Ui> por el token que copiaste:</p>
        <CopyUrl value={COMMAND} label="Comando para agregar el conector"
          display={<>claude mcp add --transport http registrapp {CONNECTOR_URL} --header &quot;Authorization: Bearer <mark className="bg-amber-200 rounded px-0.5">rap_pat_…</mark>&quot;</>} />
      </> },
      { title: "Comprobá que esté conectado", body: <>
        <p>Abrí Claude Code y escribí <Ui>/mcp</Ui>: <Ui>registrapp</Ui> tiene que aparecer en la lista, conectado.</p>
      </> },
      { title: "Preguntale", body: <FirstQuestion /> },
    ],
  },
];
