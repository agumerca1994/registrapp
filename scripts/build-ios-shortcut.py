#!/usr/bin/env python3
"""Genera y firma el Atajo de iOS que comparte un comprobante con RegistrApp.

En iPhone no existe la hoja de compartir web, así que la única vía es un Atajo.
Pedirle a cada persona que lo arme a mano con once pasos es una barrera enorme,
y este script produce el archivo listo para instalar de un toque.

**Firmar es obligatorio, no un lujo.** Desde iOS 15 un `.shortcut` sin firmar
sólo se puede importar si el usuario activa "Permitir atajos no fiables" en
Ajustes — un interruptor global, escondido y que suena peligroso. Con
`shortcuts sign --mode anyone` (CLI de macOS) el archivo se abre en cualquier
iPhone sin tocar nada.

El atajo hace tres cosas y nada más:
  1. recibe la imagen de la hoja de compartir
  2. le saca el texto con el OCR del propio iOS (framework Vision, gratis y
     en el dispositivo)
  3. abre /registrar con ese texto en la URL

Todo el parseo queda del lado del servidor a propósito: un error de parseo se
arregla con un deploy, uno adentro de un atajo ya instalado en el teléfono de
otra persona no se arregla nunca.

La estructura del plist está calcada de los atajos que Apple trae en
WorkflowKit.framework/.../Gallery.bundle (`SummarizePDF.wflow` es el más
parecido: también es de hoja de compartir y también encadena la salida de una
acción en el texto de otra).

Uso:
    python3 scripts/build-ios-shortcut.py [--base-url https://...] [--out ruta]
"""
import argparse
import plistlib
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

DEFAULT_BASE = "https://registrapp.imanzanastore.com.ar"
DEFAULT_OUT = Path("frontend/public/atajos/registrar-gasto.shortcut")

# El carácter de reemplazo de objeto: es el marcador que Shortcuts usa para
# decir "acá va una variable", y `attachmentsByRange` dice cuál.
OBJ = "￼"


def action(identifier: str, params: dict) -> dict:
    return {"WFWorkflowActionIdentifier": identifier, "WFWorkflowActionParameters": params}


def from_share_sheet() -> dict:
    """Lo que llega de la hoja de compartir."""
    return {"Value": {"Type": "ExtensionInput"}, "WFSerializationType": "WFTextTokenAttachment"}


def output_of(action_uuid: str, name: str) -> dict:
    """La salida de una acción anterior, como entrada directa."""
    return {
        "Value": {"OutputName": name, "OutputUUID": action_uuid, "Type": "ActionOutput"},
        "WFSerializationType": "WFTextTokenAttachment",
    }


def text_with_output(prefix: str, action_uuid: str, name: str) -> dict:
    """Un texto que termina con la salida de una acción anterior pegada."""
    return {
        "Value": {
            "string": prefix + OBJ,
            "attachmentsByRange": {
                # El rango es {posición, largo} y la posición es la del OBJ.
                f"{{{len(prefix)}, 1}}": {
                    "OutputName": name,
                    "OutputUUID": action_uuid,
                    "Type": "ActionOutput",
                },
            },
        },
        "WFSerializationType": "WFTextTokenString",
    }


def build(base_url: str) -> dict:
    ocr_uuid = str(uuid.uuid4()).upper()
    enc_uuid = str(uuid.uuid4()).upper()
    url_prefix = f"{base_url.rstrip('/')}/registrar?source=shortcut&text="

    return {
        "WFWorkflowClientVersion": "4018.0.4",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {
            "WFWorkflowIconGlyphNumber": 59446,     # símbolo de dinero
            "WFWorkflowIconStartColor": 946986751,  # violeta, el color de la app
        },
        "WFWorkflowImportQuestions": [],
        "WFQuickActionSurfaces": [],
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowHasShortcutInputVariables": True,
        # Sólo imágenes: así el atajo aparece cuando compartís una captura y no
        # ensucia el menú de compartir el resto del tiempo. Un PDF ya se puede
        # subir desde la propia app.
        "WFWorkflowInputContentItemClasses": ["WFImageContentItem"],
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowTypes": ["ActionExtension"],
        "WFWorkflowActions": [
            action("is.workflow.actions.extracttextfromimage", {
                "UUID": ocr_uuid,
                "WFInput": from_share_sheet(),
            }),
            action("is.workflow.actions.urlencode", {
                "UUID": enc_uuid,
                "WFInput": output_of(ocr_uuid, "Texto"),
                "WFEncodeMode": "Encode",
            }),
            action("is.workflow.actions.openurl", {
                "WFInput": text_with_output(url_prefix, enc_uuid, "Texto codificado en URL"),
            }),
        ],
    }


def build_prompt(base_url: str) -> dict:
    """El atajo que se cuelga de una automatización.

    iOS **no puede detectar que hiciste un pago** salvo que sea con una tarjeta
    de Wallet (disparador "Transacción"). Para Naranja X, Personal Pay o el
    banco, lo más cerca que se llega hoy es el disparador "App → Se cierra": se
    dispara cada vez que salís de esa app, hayas pagado o no. Por eso este atajo
    **pregunta en vez de abrir la pantalla directamente**: una automatización
    que te tira el formulario encima cada vez que cerrás el homebanking se
    desactiva a la semana.

    (El disparador por notificación —que sí sería detección real de pago— llega
    recién en iOS 27. Cuando esté, este mismo atajo sirve sin cambios: se le
    cambia el disparador y listo.)
    """
    group = str(uuid.uuid4()).upper()
    url = f"{base_url.rstrip('/')}/registrar?source=shortcut"
    menu = "is.workflow.actions.choosefrommenu"

    return {
        "WFWorkflowClientVersion": "4018.0.4",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {
            "WFWorkflowIconGlyphNumber": 59446,
            "WFWorkflowIconStartColor": 946986751,
        },
        "WFWorkflowImportQuestions": [],
        "WFQuickActionSurfaces": [],
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowHasShortcutInputVariables": False,
        "WFWorkflowInputContentItemClasses": [],
        "WFWorkflowOutputContentItemClasses": [],
        # Sin tipo: no va en la hoja de compartir, lo dispara una automatización.
        "WFWorkflowTypes": [],
        "WFWorkflowActions": [
            # WFControlFlowMode: 0 abre el menú, 1 es cada opción, 2 lo cierra.
            action(menu, {
                "GroupingIdentifier": group,
                "WFControlFlowMode": 0,
                "WFMenuPrompt": "¿Registrás el gasto?",
                "WFMenuItems": ["Sí, registrarlo", "Ahora no"],
            }),
            action(menu, {
                "GroupingIdentifier": group,
                "WFControlFlowMode": 1,
                "WFMenuItemTitle": "Sí, registrarlo",
            }),
            action("is.workflow.actions.openurl", {
                "WFInput": {
                    "Value": {"string": url},
                    "WFSerializationType": "WFTextTokenString",
                },
            }),
            action(menu, {
                "GroupingIdentifier": group,
                "WFControlFlowMode": 1,
                "WFMenuItemTitle": "Ahora no",
            }),
            action(menu, {"GroupingIdentifier": group, "WFControlFlowMode": 2}),
        ],
    }


def sign(payload: dict, out: Path, mode: str) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".shortcut", delete=False) as tmp:
        plistlib.dump(payload, tmp, fmt=plistlib.FMT_BINARY)
        unsigned = Path(tmp.name)
    try:
        subprocess.run(
            ["shortcuts", "sign", "--mode", mode, "-i", str(unsigned), "-o", str(out)],
            check=True,
        )
    finally:
        unsigned.unlink(missing_ok=True)
    # El temporal nace en 600 y `shortcuts sign` hereda esos permisos: sin esto
    # el archivo queda ilegible para el servidor web y la descarga da 403.
    out.chmod(0o644)
    print(f"firmado ({mode}): {out}  [{out.stat().st_size} bytes]")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default=DEFAULT_BASE)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--mode", default="anyone", choices=["anyone", "people-who-know-me"])
    args = ap.parse_args()

    try:
        sign(build(args.base_url), args.out, args.mode)
        sign(build_prompt(args.base_url), args.out.with_name("registrar-gasto-preguntar.shortcut"), args.mode)
    except FileNotFoundError:
        print("error: hace falta el CLI `shortcuts` de macOS para firmar.", file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as e:
        print(f"error: `shortcuts sign` falló ({e.returncode}).", file=sys.stderr)
        return e.returncode

    print(f"apuntan a: {args.base_url.rstrip('/')}/registrar")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
